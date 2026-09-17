/**
 * Issue 域 AI 工具。
 */
import { z } from 'zod';
import type { GiteaLabel } from '../../core/types';
import { defineTool, type GiteaToolContext, type GiteaToolDefinition } from './types';
import { formatBody, formatComment, formatIssueLine, relativeTime, resolveRepoRef } from './helpers';

/** owner / repo 入参的公共片段。 */
const repoArgs = {
  owner: z.string().optional().describe('仓库所属者。省略时使用当前工作区推断出的仓库。'),
  repo: z.string().optional().describe('仓库名。省略时使用当前工作区推断出的仓库。'),
};

/**
 * 把用户/模型给出的标签名解析为 Gitea 需要的标签 ID。
 * 未匹配到的名称会被忽略，并在返回值中提示，避免整体调用失败。
 * @param operations Gitea 操作集合
 * @param owner 所属者
 * @param repo 仓库名
 * @param names 标签名列表
 * @returns 命中的标签 ID 与未命中的名称
 */
async function resolveLabelIds(
  ctx: GiteaToolContext,
  owner: string,
  repo: string,
  names: string[] | undefined,
): Promise<{ ids: number[]; missing: string[] }> {
  if (!names || names.length === 0) {
    return { ids: [], missing: [] };
  }
  let labels: GiteaLabel[];
  try {
    labels = await ctx.operations.issues.listLabels(owner, repo);
  } catch {
    return { ids: [], missing: names };
  }
  const byName = new Map(labels.map((label) => [label.name.toLowerCase(), label.id]));
  const ids: number[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const id = byName.get(name.toLowerCase());
    if (id === undefined) {
      missing.push(name);
    } else {
      ids.push(id);
    }
  }
  return { ids, missing };
}

/** Issue 域工具集合。 */
export const issueTools: GiteaToolDefinition[] = [
  defineTool({
    name: 'gitea_list_issues',
    displayName: '列出 Issue',
    description:
      '列出 Issue。可限定到具体仓库，也可跨仓库检索（用于「分配给我的 Issue」「我创建的 Issue」「提及我的 Issue」等场景）。',
    userDescription: '列出 Gitea Issue',
    category: 'issue',
    access: 'read',
    inputShape: {
      ...repoArgs,
      state: z.enum(['open', 'closed', 'all']).optional().describe('状态筛选，默认 open。'),
      search: z.string().optional().describe('关键词，匹配标题与正文。'),
      labels: z.string().optional().describe('标签名，多个用英文逗号分隔。'),
      assignedToMe: z.boolean().optional().describe('只看分配给我的 Issue。'),
      createdByMe: z.boolean().optional().describe('只看我创建的 Issue。'),
      mentionedMe: z.boolean().optional().describe('只看提及我的 Issue。'),
      limit: z.number().int().min(1).max(100).optional().describe('返回数量上限，默认 30。'),
    },
    handler: async (input, ctx) => {
      const hasRepo = Boolean(input.owner && input.repo) || Boolean(ctx.defaultRepo && !input.owner);
      const ref = hasRepo ? resolveRepoRef(input, ctx) : undefined;
      const result = await ctx.operations.issues.list({
        owner: ref?.owner ?? input.owner,
        repo: ref?.repo ?? input.repo,
        state: input.state ?? 'open',
        type: 'issues',
        search: input.search,
        labels: input.labels,
        assignedToMe: input.assignedToMe,
        createdByMe: input.createdByMe,
        mentionedMe: input.mentionedMe,
        limit: input.limit ?? 30,
      });
      if (result.items.length === 0) {
        return { text: '没有匹配的 Issue。', data: { items: [] } };
      }
      const scope = ref ? `${ref.owner}/${ref.repo}` : '全部可见仓库';
      return {
        text: `${scope} 匹配到 ${result.items.length} 个 Issue：\n${result.items.map(formatIssueLine).join('\n')}`,
        data: { items: result.items },
      };
    },
  }),

  defineTool({
    name: 'gitea_get_issue',
    displayName: '获取 Issue 详情',
    description: '获取单个 Issue 的完整信息，包含正文、标签、指派人与链接。',
    userDescription: '查看 Issue 详情',
    category: 'issue',
    access: 'read',
    inputShape: {
      ...repoArgs,
      index: z.number().int().positive().describe('Issue 序号（URL 中 # 后面的数字）。'),
    },
    handler: async (input, ctx) => {
      const { owner, repo } = resolveRepoRef(input, ctx);
      const issue = await ctx.operations.issues.get(owner, repo, input.index);
      const text = [
        `# #${issue.number} ${issue.title}`,
        '',
        `- 状态：${issue.state}`,
        `- 作者：@${issue.user?.login ?? 'unknown'}`,
        `- 指派：${(issue.assignees ?? []).map((user) => `@${user.login}`).join(', ') || '无'}`,
        `- 标签：${(issue.labels ?? []).map((label) => label.name).join(', ') || '无'}`,
        `- 创建：${relativeTime(issue.created_at)}，更新：${relativeTime(issue.updated_at)}`,
        `- 评论数：${issue.comments ?? 0}`,
        `- 链接：${issue.html_url ?? '-'}`,
        '',
        '## 正文',
        '',
        formatBody(issue.body),
      ].join('\n');
      return { text, data: issue };
    },
  }),

  defineTool({
    name: 'gitea_create_issue',
    displayName: '创建 Issue',
    description:
      '在仓库中创建 Issue。`labels` 传标签名称（区分大小写不敏感），会自动解析为标签 ID；无法识别的标签会被忽略并在返回结果中说明。',
    userDescription: '创建 Gitea Issue',
    category: 'issue',
    access: 'write',
    inputShape: {
      ...repoArgs,
      title: z.string().min(1).describe('Issue 标题。'),
      body: z.string().optional().describe('Issue 正文，支持 Markdown。'),
      assignees: z.array(z.string()).optional().describe('指派人的用户名列表。'),
      labels: z.array(z.string()).optional().describe('标签名称列表。'),
    },
    handler: async (input, ctx) => {
      const { owner, repo } = resolveRepoRef(input, ctx);
      const { ids, missing } = await resolveLabelIds(ctx, owner, repo, input.labels);
      const issue = await ctx.operations.issues.create(owner, repo, {
        title: input.title,
        body: input.body,
        assignees: input.assignees,
        labels: ids.length > 0 ? ids : undefined,
      });
      const notes = missing.length > 0 ? `\n> 未识别到标签：${missing.join(', ')}（已忽略）` : '';
      return {
        text: `已创建 Issue **#${issue.number} ${issue.title}**\n- 链接：${issue.html_url ?? '-'}${notes}`,
        data: issue,
      };
    },
  }),

  defineTool({
    name: 'gitea_update_issue',
    displayName: '更新 Issue',
    description: '更新 Issue 的标题、正文、状态（关闭 / 重新打开）、指派人与标签。',
    userDescription: '修改 Gitea Issue',
    category: 'issue',
    access: 'write',
    inputShape: {
      ...repoArgs,
      index: z.number().int().positive().describe('Issue 序号。'),
      title: z.string().optional().describe('新标题。'),
      body: z.string().optional().describe('新正文。'),
      state: z.enum(['open', 'closed']).optional().describe('目标状态。'),
      assignees: z.array(z.string()).optional().describe('新的指派人用户名列表（整体替换）。'),
      labels: z.array(z.string()).optional().describe('新的标签名称列表（整体替换）。'),
    },
    handler: async (input, ctx) => {
      const { owner, repo } = resolveRepoRef(input, ctx);
      const { ids, missing } = await resolveLabelIds(ctx, owner, repo, input.labels);
      const issue = await ctx.operations.issues.update(owner, repo, input.index, {
        title: input.title,
        body: input.body,
        state: input.state,
        assignees: input.assignees,
        labels: input.labels !== undefined ? ids : undefined,
      });
      const notes = missing.length > 0 ? `\n> 未识别到标签：${missing.join(', ')}（已忽略）` : '';
      return {
        text: `已更新 Issue **#${issue.number}**，当前状态 ${issue.state}${notes}`,
        data: issue,
      };
    },
  }),

  defineTool({
    name: 'gitea_comment_issue',
    displayName: '评论 Issue',
    description: '在 Issue（或 PR 的对话区）中发表评论。',
    userDescription: '评论 Gitea Issue',
    category: 'issue',
    access: 'write',
    inputShape: {
      ...repoArgs,
      index: z.number().int().positive().describe('Issue 序号。'),
      body: z.string().min(1).describe('评论正文，支持 Markdown。'),
    },
    handler: async (input, ctx) => {
      const { owner, repo } = resolveRepoRef(input, ctx);
      const comment = await ctx.operations.issues.createComment(owner, repo, input.index, input.body);
      return {
        text: `已发表评论（#${comment.id}）：${comment.html_url ?? ''}`,
        data: comment,
      };
    },
  }),

  defineTool({
    name: 'gitea_list_issue_comments',
    displayName: '列出 Issue 评论',
    description: '列出 Issue 的时间线评论，用于了解讨论上下文。',
    userDescription: '查看 Issue 评论',
    category: 'issue',
    access: 'read',
    inputShape: {
      ...repoArgs,
      index: z.number().int().positive().describe('Issue 序号。'),
      limit: z.number().int().min(1).max(200).optional().describe('返回数量上限，默认 50。'),
    },
    handler: async (input, ctx) => {
      const { owner, repo } = resolveRepoRef(input, ctx);
      const result = await ctx.operations.issues.listComments(owner, repo, input.index, 1, input.limit ?? 50);
      if (result.items.length === 0) {
        return { text: '该 Issue 暂无评论。', data: { items: [] } };
      }
      const blocks = result.items.map((comment, position) => formatComment(comment, position + 1));
      return {
        text: `共 ${result.items.length} 条评论：\n\n${blocks.join('\n\n---\n\n')}`,
        data: { items: result.items },
      };
    },
  }),
];
