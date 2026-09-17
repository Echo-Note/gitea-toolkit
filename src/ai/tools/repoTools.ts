/**
 * 仓库域 AI 工具：列表 / 详情 / 创建 / 分支 / 提交 / 文件读写。
 */
import { z } from 'zod';
import type { GiteaContentsResponse } from '../../core/types';
import { defineTool, type GiteaToolDefinition } from './types';
import { formatRepoLine, relativeTime, resolveRepoRef, truncate } from './helpers';

/** owner / repo 入参的公共片段。 */
const repoArgs = {
  owner: z.string().optional().describe('仓库所属者（用户名或组织名）。省略时使用当前工作区推断出的仓库。'),
  repo: z.string().optional().describe('仓库名。省略时使用当前工作区推断出的仓库。'),
};

/** 仓库域工具集合。 */
export const repoTools: GiteaToolDefinition[] = [
  defineTool({
    name: 'gitea_list_repos',
    displayName: '列出仓库',
    description:
      '列出当前令牌可见的 Gitea 仓库，支持按组织过滤或关键词搜索。返回仓库全名、默认分支、未关闭 Issue / PR 数量与最后更新时间。',
    userDescription: '列出 Gitea 仓库',
    category: 'repository',
    access: 'read',
    inputShape: {
      owner: z.string().optional().describe('只看某个组织或用户的仓库。'),
      search: z.string().optional().describe('关键词搜索；提供后会走全文搜索接口。'),
      mine: z.boolean().optional().describe('设为 true 时只列出当前令牌所属用户拥有的仓库。'),
      limit: z.number().int().min(1).max(100).optional().describe('返回数量上限，默认 30。'),
    },
    handler: async (input, ctx) => {
      const result = await ctx.operations.repos.list({
        owner: input.owner,
        search: input.search,
        mine: input.mine,
        limit: input.limit ?? 30,
      });
      if (result.items.length === 0) {
        return { text: '没有找到匹配的仓库。', data: { total: 0, items: [] } };
      }
      const header = `共 ${result.items.length} 个仓库${result.pageInfo.hasNextPage ? '（还有更多，可调大 limit）' : ''}：\n`;
      return {
        text: header + result.items.map(formatRepoLine).join('\n'),
        data: { total: result.items.length, items: result.items },
      };
    },
  }),

  defineTool({
    name: 'gitea_get_repo',
    displayName: '获取仓库详情',
    description: '获取指定 Gitea 仓库的详细信息，包括默认分支、权限、是否为空仓库、克隆地址等。',
    userDescription: '查看仓库详情',
    category: 'repository',
    access: 'read',
    inputShape: { ...repoArgs },
    handler: async (input, ctx) => {
      const { owner, repo } = resolveRepoRef(input, ctx);
      const detail = await ctx.operations.repos.get(owner, repo);
      const permissions = detail.permissions ?? {};
      const text = [
        `# ${detail.full_name}`,
        detail.description ? `\n${detail.description}` : '',
        '',
        `- 默认分支：\`${detail.default_branch}\``,
        `- 可见性：${detail.private ? '私有' : '公开'}`,
        `- 权限：pull=${Boolean(permissions.pull)} push=${Boolean(permissions.push)} admin=${Boolean(permissions.admin)}`,
        `- 未关闭 Issue：${detail.open_issues_count ?? 0}，开放 PR：${detail.open_pr_counter ?? 0}`,
        `- 主语言：${detail.language ?? '未知'}，星标：${detail.stars_count ?? 0}`,
        `- 克隆地址：${detail.clone_url ?? '-'}`,
        `- SSH 地址：${detail.ssh_url ?? '-'}`,
        `- 最后更新：${relativeTime(detail.updated_at)}`,
        `- 网页地址：${detail.html_url}`,
      ]
        .filter((line) => line !== '')
        .join('\n');
      return { text, data: detail };
    },
  }),

  defineTool({
    name: 'gitea_create_repo',
    displayName: '创建仓库',
    description:
      '在 Gitea 上创建新仓库。可通过 `owner` 指定组织；不指定时创建到当前令牌所属用户名下。默认会自动初始化 README。',
    userDescription: '创建 Gitea 仓库',
    category: 'repository',
    access: 'write',
    inputShape: {
      name: z.string().min(1).describe('仓库名。'),
      owner: z.string().optional().describe('组织名；省略则创建到当前用户名下。'),
      description: z.string().optional().describe('仓库描述。'),
      private: z.boolean().optional().describe('是否设为私有，默认 false。'),
      autoInit: z.boolean().optional().describe('是否自动初始化（生成 README），默认 true。'),
      defaultBranch: z.string().optional().describe('默认分支名，例如 main。'),
    },
    handler: async (input, ctx) => {
      const created = await ctx.operations.repos.create({
        name: input.name,
        owner: input.owner,
        description: input.description,
        private: input.private,
        autoInit: input.autoInit ?? true,
        defaultBranch: input.defaultBranch,
      });
      return {
        text: `已创建仓库 **${created.full_name}**\n- 默认分支：\`${created.default_branch}\`\n- 克隆地址：${created.clone_url ?? '-'}\n- 网页地址：${created.html_url}`,
        data: created,
      };
    },
  }),

  defineTool({
    name: 'gitea_list_branches',
    displayName: '列出分支',
    description: '列出仓库的所有分支及其最新提交 SHA。',
    userDescription: '列出仓库分支',
    category: 'repository',
    access: 'read',
    inputShape: {
      ...repoArgs,
      limit: z.number().int().min(1).max(200).optional().describe('返回数量上限，默认 50。'),
    },
    handler: async (input, ctx) => {
      const { owner, repo } = resolveRepoRef(input, ctx);
      const result = await ctx.operations.repos.listBranches(owner, repo, 1, input.limit ?? 50);
      if (result.items.length === 0) {
        return { text: '该仓库没有分支。', data: { items: [] } };
      }
      const lines = result.items.map(
        (branch) =>
          `- \`${branch.name}\`${branch.protected ? '（受保护）' : ''} → ${branch.commit?.id.slice(0, 10) ?? '-'} ${(branch.commit?.message ?? '').split('\n')[0]}`,
      );
      return {
        text: `${owner}/${repo} 共 ${result.items.length} 个分支：\n${lines.join('\n')}`,
        data: { items: result.items },
      };
    },
  }),

  defineTool({
    name: 'gitea_create_branch',
    displayName: '创建分支',
    description: '基于已有分支 / 标签 / 提交创建新分支。',
    userDescription: '创建分支',
    category: 'repository',
    access: 'write',
    inputShape: {
      ...repoArgs,
      newBranch: z.string().min(1).describe('新分支名。'),
      from: z.string().optional().describe('源分支 / 标签 / 提交 SHA；省略时基于仓库默认分支。'),
    },
    handler: async (input, ctx) => {
      const { owner, repo } = resolveRepoRef(input, ctx);
      const branch = await ctx.operations.repos.createBranch(owner, repo, input.newBranch, input.from);
      return {
        text: `已创建分支 \`${branch.name}\`（HEAD ${branch.commit?.id.slice(0, 10) ?? '-'}）`,
        data: branch,
      };
    },
  }),

  defineTool({
    name: 'gitea_list_commits',
    displayName: '列出提交',
    description: '列出仓库某个分支 / 路径上的提交历史。',
    userDescription: '查看提交历史',
    category: 'repository',
    access: 'read',
    inputShape: {
      ...repoArgs,
      ref: z.string().optional().describe('分支名 / 标签 / 提交 SHA；省略时使用默认分支。'),
      path: z.string().optional().describe('仅列出影响该文件或目录的提交。'),
      limit: z.number().int().min(1).max(100).optional().describe('返回数量上限，默认 20。'),
    },
    handler: async (input, ctx) => {
      const { owner, repo } = resolveRepoRef(input, ctx);
      const result = await ctx.operations.repos.listCommits(owner, repo, {
        ref: input.ref,
        path: input.path,
        limit: input.limit ?? 20,
      });
      if (result.items.length === 0) {
        return { text: '没有查询到提交记录。', data: { items: [] } };
      }
      const lines = result.items.map((commit) => {
        const message = (commit.commit?.message ?? '').split('\n')[0];
        const author = commit.commit?.author?.name ?? commit.author?.login ?? 'unknown';
        return `- \`${commit.sha.slice(0, 10)}\` ${message} — ${author}，${relativeTime(commit.created ?? commit.commit?.author?.date)}`;
      });
      return {
        text: `${owner}/${repo} 最近 ${result.items.length} 条提交：\n${lines.join('\n')}`,
        data: { items: result.items },
      };
    },
  }),

  defineTool({
    name: 'gitea_list_files',
    displayName: '列出目录',
    description: '列出仓库中某个目录下的文件与子目录。',
    userDescription: '浏览仓库目录',
    category: 'repository',
    access: 'read',
    inputShape: {
      ...repoArgs,
      path: z.string().optional().describe('目录路径，省略表示仓库根目录。'),
      ref: z.string().optional().describe('分支名 / 标签 / 提交 SHA。'),
    },
    handler: async (input, ctx) => {
      const { owner, repo } = resolveRepoRef(input, ctx);
      const entries = await ctx.operations.repos.getContents(owner, repo, input.path ?? '', input.ref);
      const list: GiteaContentsResponse[] = Array.isArray(entries) ? entries : [entries];
      const lines = list.map((entry) => {
        const type = entry.type === 'dir' ? '目录' : entry.type;
        return `- \`${entry.path}\`（${type}${entry.size !== undefined ? `，${entry.size} 字节` : ''}）`;
      });
      return {
        text: `${owner}/${repo}/${input.path ?? ''} 共 ${list.length} 个条目：\n${lines.join('\n')}`,
        data: { items: list },
      };
    },
  }),

  defineTool({
    name: 'gitea_get_file',
    displayName: '读取文件',
    description: '读取仓库中指定文件的文本内容（自动 base64 解码），同时返回文件 blob SHA，便于后续更新。',
    userDescription: '读取仓库文件',
    category: 'repository',
    access: 'read',
    inputShape: {
      ...repoArgs,
      filePath: z.string().min(1).describe('仓库内文件路径，例如 src/main.ts。'),
      ref: z.string().optional().describe('分支名 / 标签 / 提交 SHA。'),
    },
    handler: async (input, ctx) => {
      const { owner, repo } = resolveRepoRef(input, ctx);
      const file = await ctx.operations.repos.getFileContent(owner, repo, input.filePath, input.ref);
      return {
        text: `\`${file.path}\`（${file.size} 字节，blob ${file.sha.slice(0, 10)}${file.truncated ? '，已截断' : ''}）\n\n\`\`\`\n${truncate(file.content, 40_000)}\n\`\`\``,
        data: { path: file.path, sha: file.sha, size: file.size, truncated: file.truncated, content: file.content },
      };
    },
  }),

  defineTool({
    name: 'gitea_get_commit_status',
    displayName: '查询提交状态',
    description:
      '查询某个分支 / 标签 / 提交的 CI 合并状态（Gitea Actions 等）。返回 overall 状态与每个检查项的明细，可用于判断 PR 是否通过检查。',
    userDescription: '查询提交 CI 状态',
    category: 'repository',
    access: 'read',
    inputShape: {
      ...repoArgs,
      ref: z.string().min(1).describe('分支名 / 标签 / 提交 SHA。'),
    },
    handler: async (input, ctx) => {
      const { owner, repo } = resolveRepoRef(input, ctx);
      const status = await ctx.operations.repos.getCombinedStatus(owner, repo, input.ref);
      const statuses = status.statuses ?? [];
      if (statuses.length === 0) {
        return { text: `\`${input.ref}\` 没有任何 CI 状态记录。`, data: status };
      }
      const lines = statuses.map(
        (item) =>
          `- ${item.status === 'success' ? '✅' : item.status === 'pending' ? '⏳' : '❌'} **${item.context ?? 'check'}**：${item.status}${item.description ? ` — ${item.description}` : ''}`,
      );
      return {
        text: `\`${input.ref}\` 合并状态：**${status.state}**（共 ${statuses.length} 项）\n${lines.join('\n')}`,
        data: status,
      };
    },
  }),

  defineTool({
    name: 'gitea_commit_file',
    displayName: '提交文件',
    description:
      '在仓库中创建或更新一个文件并提交。文件已存在时自动带上 blob SHA 执行更新。可通过 `newBranch` 把改动提交到新分支。',
    userDescription: '创建或更新仓库文件',
    category: 'repository',
    access: 'write',
    inputShape: {
      ...repoArgs,
      filePath: z.string().min(1).describe('仓库内文件路径。'),
      content: z.string().describe('文件完整文本内容（无需 base64）。'),
      message: z.string().optional().describe('提交信息。'),
      branch: z.string().optional().describe('目标分支；省略时使用仓库默认分支。'),
      newBranch: z.string().optional().describe('提供时会在该新分支上提交。'),
    },
    handler: async (input, ctx) => {
      const { owner, repo } = resolveRepoRef(input, ctx);
      const result = await ctx.operations.repos.commitFile(owner, repo, input.filePath, {
        content: input.content,
        message: input.message,
        branch: input.branch,
        newBranch: input.newBranch,
      });
      const sha = result.commit?.sha?.slice(0, 10) ?? '-';
      const message = result.commit?.message ?? input.message ?? '-';
      return {
        text: `已提交 \`${input.filePath}\`\n- commit：\`${sha}\`\n- 信息：${message}\n- 链接：${result.commit?.html_url ?? '-'}`,
        data: result,
      };
    },
  }),
];
