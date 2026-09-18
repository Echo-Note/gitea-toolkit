/**
 * Gitea Actions 域 AI 工具。
 *
 * 能力边界（与 Gitea 1.26.4 的 API 一致，不要凭空加）：
 *   - **没有「取消运行」**：Gitea 只提供 rerun / rerun-failed-jobs。
 *     `DELETE /actions/runs/{run}` 是删除记录，语义不同，这里刻意不暴露。
 *   - 产物只列不下载：下载是 zip 二进制流，不适合作为工具返回值；
 *     需要时用 `archive_download_url` 或走网页。
 */
import { z } from 'zod';
import { defineTool, type GiteaToolDefinition } from './types';
import {
  actionStateLabel,
  formatArtifactLine,
  formatJobLine,
  formatRunLine,
  formatWorkflowLine,
  relativeTime,
  resolveRepoRef,
  tailLines,
} from './helpers';

/** owner / repo 入参的公共片段。 */
const repoArgs = {
  owner: z.string().optional().describe('仓库所属者。省略时使用当前工作区推断出的仓库。'),
  repo: z.string().optional().describe('仓库名。省略时使用当前工作区推断出的仓库。'),
};

/** Actions 域工具集合。 */
export const actionTools: GiteaToolDefinition[] = [
  defineTool({
    name: 'gitea_list_workflows',
    displayName: '列出工作流',
    description:
      '列出仓库的全部工作流（即 .gitea/workflows 下的 YAML），包含启用状态与工作流 ID。',
    userDescription: '列出 Gitea 工作流',
    category: 'action',
    access: 'read',
    inputShape: { ...repoArgs },
    handler: async (input, ctx) => {
      const { owner, repo } = resolveRepoRef(input, ctx);
      const workflows = await ctx.operations.actions.listWorkflows({ owner, repo });
      if (workflows.length === 0) {
        return {
          text: `${owner}/${repo} 没有配置任何工作流（应在 \`.gitea/workflows/\` 下）。`,
          data: { items: [] },
        };
      }
      return {
        text: `${owner}/${repo} 共 ${workflows.length} 个工作流：\n${workflows.map(formatWorkflowLine).join('\n')}`,
        data: { items: workflows },
      };
    },
  }),

  defineTool({
    name: 'gitea_list_action_runs',
    displayName: '列出工作流运行记录',
    description:
      '列出仓库的工作流运行记录，支持按触发事件、分支、状态、触发者、提交 SHA 过滤，用于排查 CI 是否通过。',
    userDescription: '列出工作流运行记录',
    category: 'action',
    access: 'read',
    inputShape: {
      ...repoArgs,
      event: z
        .string()
        .optional()
        .describe('触发事件过滤，例如 push / pull_request / workflow_dispatch / schedule。'),
      branch: z.string().optional().describe('按分支过滤。'),
      status: z
        .string()
        .optional()
        .describe('按状态过滤，例如 success / failure / running / waiting。'),
      actor: z.string().optional().describe('按触发者用户名过滤。'),
      head_sha: z.string().optional().describe('按提交 SHA 过滤。'),
      limit: z.number().int().min(1).max(100).optional().describe('返回数量上限，默认 20。'),
    },
    handler: async (input, ctx) => {
      const { owner, repo } = resolveRepoRef(input, ctx);
      const result = await ctx.operations.actions.listRuns({
        owner,
        repo,
        event: input.event,
        branch: input.branch,
        status: input.status,
        actor: input.actor,
        headSha: input.head_sha,
        limit: input.limit ?? 20,
      });
      if (result.items.length === 0) {
        return { text: '没有匹配的运行记录。', data: { items: [] } };
      }
      const more = result.pageInfo.hasNextPage ? '\n\n_还有更多记录，可调整过滤条件或增大 limit。_' : '';
      return {
        text: `${owner}/${repo} 匹配到 ${result.items.length} 条运行记录：\n${result.items.map(formatRunLine).join('\n')}${more}`,
        data: { items: result.items, pageInfo: result.pageInfo },
      };
    },
  }),

  defineTool({
    name: 'gitea_get_action_run',
    displayName: '获取工作流运行详情',
    description:
      '获取单次工作流运行（workflow run）的详情，并列出它包含的全部作业及其步骤状态，用于定位是哪一步失败。',
    userDescription: '查看工作流运行详情',
    category: 'action',
    access: 'read',
    inputShape: {
      ...repoArgs,
      run_id: z.number().int().positive().describe('运行 ID（列表结果里的 run id，不是 # 后面的编号）。'),
    },
    handler: async (input, ctx) => {
      const { owner, repo } = resolveRepoRef(input, ctx);
      const [run, jobs] = await Promise.all([
        ctx.operations.actions.getRun(owner, repo, input.run_id),
        ctx.operations.actions.listRunJobs(owner, repo, input.run_id),
      ]);
      const header = `**#${run.run_number ?? run.id}** ${run.display_title ?? ''} —— ${actionStateLabel(run.status, run.conclusion)}`;
      const meta = [
        run.event ? `事件 \`${run.event}\`` : '',
        run.head_branch ? `分支 \`${run.head_branch}\`` : '',
        run.head_sha ? `提交 \`${run.head_sha.slice(0, 7)}\`` : '',
        run.actor?.login ? `触发者 @${run.actor.login}` : '',
        `开始于 ${relativeTime(run.started_at)}`,
      ]
        .filter(Boolean)
        .join(' · ');
      const failed = jobs.filter((job) => job.conclusion === 'failure');
      const jobText =
        jobs.length === 0 ? '_（暂无作业）_' : jobs.map(formatJobLine).join('\n');
      const hint =
        failed.length > 0
          ? `\n\n> 失败作业：${failed.map((job) => `\`${job.name}\`（job id \`${job.id}\`）`).join('、')}，可用 \`gitea_get_job_logs\` 查看日志。`
          : '';
      return {
        text: `${header}\n\n${meta}\n\n作业：\n${jobText}${hint}`,
        data: { run, jobs },
      };
    },
  }),

  defineTool({
    name: 'gitea_get_job_logs',
    displayName: '获取作业日志',
    description:
      '获取某个工作流作业的原始日志文本。默认只保留**末尾**若干行，因为失败信息通常出现在最后。',
    userDescription: '查看作业日志',
    category: 'action',
    access: 'read',
    inputShape: {
      ...repoArgs,
      job_id: z.number().int().positive().describe('作业 ID（可从 gitea_get_action_run 的结果取得）。'),
      tail_lines: z
        .number()
        .int()
        .min(10)
        .max(2000)
        .optional()
        .describe('保留末尾多少行，默认 200。'),
    },
    handler: async (input, ctx) => {
      const { owner, repo } = resolveRepoRef(input, ctx);
      const raw = await ctx.operations.actions.getJobLogs(owner, repo, input.job_id);
      if (raw.trim().length === 0) {
        return { text: `作业 \`${input.job_id}\` 没有日志（可能仍在排队，或日志已被清理）。`, data: {} };
      }
      const { text, truncated } = tailLines(raw, input.tail_lines ?? 200);
      const note = truncated ? '\n\n_（日志较长，以上仅为末尾部分）_' : '';
      return {
        text: `作业 \`${input.job_id}\` 的日志：\n\n\`\`\`\n${text}\n\`\`\`${note}`,
        data: { jobId: input.job_id, truncated },
      };
    },
  }),

  defineTool({
    name: 'gitea_list_artifacts',
    displayName: '列出构建产物',
    description: '列出仓库的工作流构建产物（artifact），包含大小与是否已过期。',
    userDescription: '列出构建产物',
    category: 'action',
    access: 'read',
    inputShape: {
      ...repoArgs,
      name: z.string().optional().describe('按产物名精确过滤。'),
      limit: z.number().int().min(1).max(100).optional().describe('返回数量上限，默认 20。'),
    },
    handler: async (input, ctx) => {
      const { owner, repo } = resolveRepoRef(input, ctx);
      const result = await ctx.operations.actions.listArtifacts({
        owner,
        repo,
        name: input.name,
        limit: input.limit ?? 20,
      });
      if (result.items.length === 0) {
        return { text: '没有匹配的构建产物。', data: { items: [] } };
      }
      return {
        text: `${owner}/${repo} 匹配到 ${result.items.length} 个产物：\n${result.items.map(formatArtifactLine).join('\n')}`,
        data: { items: result.items, pageInfo: result.pageInfo },
      };
    },
  }),

  defineTool({
    name: 'gitea_dispatch_workflow',
    displayName: '触发工作流',
    description:
      '手动触发一个声明了 `on: workflow_dispatch` 的 Gitea 工作流，可指定分支/标签/提交与 inputs。' +
      '若工作流未声明 workflow_dispatch，服务端会拒绝。',
    userDescription: '手动触发 Gitea 工作流',
    category: 'action',
    access: 'write',
    inputShape: {
      ...repoArgs,
      workflow_id: z
        .string()
        .describe('工作流 ID 或文件名，例如 `ci.yml`。可用 gitea_list_workflows 查询。'),
      ref: z.string().describe('目标引用：分支名、标签名或提交 SHA。'),
      inputs: z
        .record(z.string())
        .optional()
        .describe('传给工作流的输入键值对（字符串），对应 workflow_dispatch 声明的 inputs。'),
    },
    handler: async (input, ctx) => {
      const { owner, repo } = resolveRepoRef(input, ctx);
      await ctx.operations.actions.dispatchWorkflow({
        owner,
        repo,
        workflowId: input.workflow_id,
        ref: input.ref,
        inputs: input.inputs,
      });
      const inputNote =
        input.inputs && Object.keys(input.inputs).length > 0
          ? `\n\n传入的 inputs：\n\`\`\`json\n${JSON.stringify(input.inputs, null, 2)}\n\`\`\``
          : '';
      return {
        text: `已触发工作流 \`${input.workflow_id}\`（ref \`${input.ref}\`）于 ${owner}/${repo}。运行需要一点时间才会出现在列表中。${inputNote}`,
        data: { workflowId: input.workflow_id, ref: input.ref },
      };
    },
  }),

  defineTool({
    name: 'gitea_rerun_action',
    displayName: '重新运行工作流',
    description:
      '重新运行一次工作流运行记录：可整条重跑，也可只重跑失败的作业。' +
      '注意 Gitea 的 API **不提供取消运行**，只有重跑。',
    userDescription: '重新运行 Gitea 工作流',
    category: 'action',
    access: 'write',
    inputShape: {
      ...repoArgs,
      run_id: z.number().int().positive().describe('运行 ID。'),
      failed_only: z
        .boolean()
        .optional()
        .describe('设为 true 时只重跑失败的作业，默认 false（整条重跑）。'),
    },
    handler: async (input, ctx) => {
      const { owner, repo } = resolveRepoRef(input, ctx);
      const failedOnly = input.failed_only === true;
      if (failedOnly) {
        await ctx.operations.actions.rerunFailedJobs(owner, repo, input.run_id);
      } else {
        await ctx.operations.actions.rerunRun(owner, repo, input.run_id);
      }
      return {
        text: `已提交重跑请求：${owner}/${repo} 运行 \`${input.run_id}\`（${failedOnly ? '仅失败的作业' : '整条运行'}）。`,
        data: { runId: input.run_id, failedOnly },
      };
    },
  }),

  defineTool({
    name: 'gitea_set_workflow_enabled',
    displayName: '启用/停用工作流',
    description: '启用或停用一个 Gitea 工作流。停用后该工作流不会响应任何触发事件。',
    userDescription: '启用或停用 Gitea 工作流',
    category: 'action',
    access: 'write',
    inputShape: {
      ...repoArgs,
      workflow_id: z.string().describe('工作流 ID 或文件名，例如 `ci.yml`。'),
      enabled: z.boolean().describe('true 为启用，false 为停用。'),
    },
    handler: async (input, ctx) => {
      const { owner, repo } = resolveRepoRef(input, ctx);
      await ctx.operations.actions.setWorkflowEnabled(owner, repo, input.workflow_id, input.enabled);
      return {
        text: `已${input.enabled ? '启用' : '停用'}工作流 \`${input.workflow_id}\`（${owner}/${repo}）。`,
        data: { workflowId: input.workflow_id, enabled: input.enabled },
      };
    },
  }),
];
