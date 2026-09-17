/**
 * Pull Request 域 AI 工具。
 */
import { z } from 'zod';
import { defineTool, type GiteaToolDefinition } from './types';
import { formatBody, formatPullLine, relativeTime, resolveRepoRef, truncate } from './helpers';

/** owner / repo 入参的公共片段。 */
const repoArgs = {
  owner: z.string().optional().describe('仓库所属者。省略时使用当前工作区推断出的仓库。'),
  repo: z.string().optional().describe('仓库名。省略时使用当前工作区推断出的仓库。'),
};

/** Pull Request 域工具集合。 */
export const pullTools: GiteaToolDefinition[] = [
  defineTool({
    name: 'gitea_list_pulls',
    displayName: '列出 Pull Request',
    description: '列出仓库的 Pull Request，支持按状态、分支与排序过滤。',
    userDescription: '列出 Gitea Pull Request',
    category: 'pull',
    access: 'read',
    inputShape: {
      ...repoArgs,
      state: z.enum(['open', 'closed', 'all']).optional().describe('状态筛选，默认 open。'),
      sort: z
        .enum(['oldest', 'recentupdate', 'leastupdate', 'mostcomment', 'leastcomment', 'priority'])
        .optional()
        .describe('排序方式，默认 oldest。'),
      head: z.string().optional().describe('按源分支过滤。'),
      base: z.string().optional().describe('按目标分支过滤。'),
      limit: z.number().int().min(1).max(100).optional().describe('返回数量上限，默认 30。'),
    },
    handler: async (input, ctx) => {
      const { owner, repo } = resolveRepoRef(input, ctx);
      const result = await ctx.operations.pulls.list({
        owner,
        repo,
        state: input.state ?? 'open',
        sort: input.sort,
        head: input.head,
        base: input.base,
        limit: input.limit ?? 30,
      });
      if (result.items.length === 0) {
        return { text: '没有匹配的 Pull Request。', data: { items: [] } };
      }
      return {
        text: `${owner}/${repo} 匹配到 ${result.items.length} 个 PR：\n${result.items.map(formatPullLine).join('\n')}`,
        data: { items: result.items },
      };
    },
  }),

  defineTool({
    name: 'gitea_get_pull',
    displayName: '获取 PR 详情',
    description: '获取单个 Pull Request 的详情，包含可合并状态、变更规模、评审人等信息。',
    userDescription: '查看 Pull Request 详情',
    category: 'pull',
    access: 'read',
    inputShape: {
      ...repoArgs,
      index: z.number().int().positive().describe('PR 序号。'),
    },
    handler: async (input, ctx) => {
      const { owner, repo } = resolveRepoRef(input, ctx);
      const pull = await ctx.operations.pulls.get(owner, repo, input.index);
      const text = [
        `# #${pull.number} ${pull.title}`,
        '',
        `- 状态：${pull.state}${pull.merged ? '（已合并）' : ''}${pull.draft ? '（草稿）' : ''}`,
        `- 分支：\`${pull.head?.ref ?? '-'}\` → \`${pull.base?.ref ?? '-'}\``,
        `- 可合并：${pull.mergeable === undefined ? '未知' : pull.mergeable ? '是' : '否'}`,
        `- 变更：+${pull.additions ?? 0} / -${pull.deletions ?? 0}，${pull.changed_files ?? 0} 个文件`,
        `- 作者：@${pull.user?.login ?? 'unknown'}`,
        `- 评审人：${(pull.requested_reviewers ?? []).map((user) => `@${user.login}`).join(', ') || '无'}`,
        `- 创建：${relativeTime(pull.created_at)}，更新：${relativeTime(pull.updated_at)}`,
        `- 链接：${pull.html_url ?? '-'}`,
        '',
        '## 描述',
        '',
        formatBody(pull.body),
      ].join('\n');
      return { text, data: pull };
    },
  }),

  defineTool({
    name: 'gitea_get_pull_diff',
    displayName: '查看 PR 差异',
    description:
      '获取 Pull Request 的 unified diff 文本，用于代码评审。内容较长时会被截断，可配合 `gitea_list_pull_files` 先锁定关注文件。',
    userDescription: '查看 Pull Request 代码差异',
    category: 'pull',
    access: 'read',
    inputShape: {
      ...repoArgs,
      index: z.number().int().positive().describe('PR 序号。'),
      format: z.enum(['diff', 'patch']).optional().describe('输出格式，默认 diff。'),
      maxLength: z.number().int().min(2000).max(200_000).optional().describe('最大返回字符数，默认 40000。'),
    },
    handler: async (input, ctx) => {
      const { owner, repo } = resolveRepoRef(input, ctx);
      const diff = await ctx.operations.pulls.getDiff(owner, repo, input.index, input.format ?? 'diff');
      const limited = truncate(diff, input.maxLength ?? 40_000);
      return {
        text: `\`${owner}/${repo}\` PR #${input.index} 的差异（共 ${diff.length} 字符）：\n\n\`\`\`diff\n${limited}\n\`\`\``,
        data: { diff: limited, truncated: limited.length < diff.length },
      };
    },
  }),

  defineTool({
    name: 'gitea_list_pull_files',
    displayName: '列出 PR 变更文件',
    description: '列出 Pull Request 涉及的文件及每个文件的新增 / 删除行数，便于快速定位评审重点。',
    userDescription: '列出 Pull Request 变更文件',
    category: 'pull',
    access: 'read',
    inputShape: {
      ...repoArgs,
      index: z.number().int().positive().describe('PR 序号。'),
    },
    handler: async (input, ctx) => {
      const { owner, repo } = resolveRepoRef(input, ctx);
      const files = await ctx.operations.pulls.listFiles(owner, repo, input.index);
      if (files.length === 0) {
        return { text: '该 PR 没有文件变更。', data: { items: [] } };
      }
      const lines = files.map(
        (file) =>
          `- \`${file.filename}\`（${file.status ?? 'modified'}，+${file.additions ?? 0} / -${file.deletions ?? 0}）`,
      );
      return {
        text: `PR #${input.index} 共 ${files.length} 个文件变更：\n${lines.join('\n')}`,
        data: { items: files },
      };
    },
  }),

  defineTool({
    name: 'gitea_create_pull',
    displayName: '创建 Pull Request',
    description: '创建 Pull Request。head 与 base 均为分支名，head 可写成 `owner:branch` 形式以支持跨仓库 PR。',
    userDescription: '创建 Pull Request',
    category: 'pull',
    access: 'write',
    inputShape: {
      ...repoArgs,
      title: z.string().min(1).describe('PR 标题。'),
      head: z.string().min(1).describe('源分支名，或 `owner:branch`。'),
      base: z.string().min(1).describe('目标分支名。'),
      body: z.string().optional().describe('PR 描述，支持 Markdown。'),
      reviewers: z.array(z.string()).optional().describe('评审人用户名列表。'),
      assignees: z.array(z.string()).optional().describe('指派人用户名列表。'),
    },
    handler: async (input, ctx) => {
      const { owner, repo } = resolveRepoRef(input, ctx);
      const pull = await ctx.operations.pulls.create(owner, repo, {
        title: input.title,
        head: input.head,
        base: input.base,
        body: input.body,
        reviewers: input.reviewers,
        assignees: input.assignees,
      });
      return {
        text: `已创建 PR **#${pull.number} ${pull.title}**\n- 链接：${pull.html_url ?? '-'}`,
        data: pull,
      };
    },
  }),

  defineTool({
    name: 'gitea_merge_pull',
    displayName: '合并 Pull Request',
    description: '合并 Pull Request，支持选择合并策略并可在合并后删除源分支。',
    userDescription: '合并 Pull Request',
    category: 'pull',
    access: 'write',
    inputShape: {
      ...repoArgs,
      index: z.number().int().positive().describe('PR 序号。'),
      strategy: z
        .enum(['merge', 'rebase', 'rebase-merge', 'squash', 'fast-forward-only'])
        .optional()
        .describe('合并策略，默认 merge。'),
      deleteBranchAfterMerge: z.boolean().optional().describe('合并后删除源分支。'),
      mergeTitle: z.string().optional().describe('自定义合并提交标题。'),
      mergeMessage: z.string().optional().describe('自定义合并提交信息。'),
    },
    handler: async (input, ctx) => {
      const { owner, repo } = resolveRepoRef(input, ctx);
      const result = await ctx.operations.pulls.merge(owner, repo, input.index, {
        strategy: input.strategy,
        deleteBranchAfterMerge: input.deleteBranchAfterMerge,
        mergeTitle: input.mergeTitle,
        mergeMessage: input.mergeMessage,
      });
      return { text: `${owner}/${repo} ${result.message}`, data: result };
    },
  }),

  defineTool({
    name: 'gitea_review_pull',
    displayName: '评审 Pull Request',
    description: '提交 PR 评审意见：批准（APPROVED）、请求修改（REQUEST_CHANGES）或仅评论（COMMENT）。',
    userDescription: '评审 Pull Request',
    category: 'pull',
    access: 'write',
    inputShape: {
      ...repoArgs,
      index: z.number().int().positive().describe('PR 序号。'),
      event: z
        .enum(['APPROVED', 'REQUEST_CHANGES', 'COMMENT'])
        .describe('评审动作。'),
      body: z.string().optional().describe('评审说明，支持 Markdown。REQUEST_CHANGES 时建议必填。'),
    },
    handler: async (input, ctx) => {
      const { owner, repo } = resolveRepoRef(input, ctx);
      const review = await ctx.operations.pulls.createReview(owner, repo, input.index, {
        event: input.event,
        body: input.body,
      });
      const actionText =
        input.event === 'APPROVED' ? '已批准' : input.event === 'REQUEST_CHANGES' ? '已请求修改' : '已提交评论';
      return {
        text: `PR #${input.index} ${actionText}（评审 #${review.id}）`,
        data: review,
      };
    },
  }),
];
