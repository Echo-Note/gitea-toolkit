/**
 * 账号 / 组织 / 通知域 AI 工具。
 */
import { z } from 'zod';
import { defineTool, type GiteaToolDefinition } from './types';
import { relativeTime } from './helpers';
import { compatibilityStatusLine, evaluateCompatibility } from '../../core/version';

/** 账号域工具集合。 */
export const accountTools: GiteaToolDefinition[] = [
  defineTool({
    name: 'gitea_get_current_user',
    displayName: '获取当前用户',
    description:
      '获取当前访问令牌对应的 Gitea 用户信息。也可用于校验令牌是否有效、实例是否可连通。',
    userDescription: '查看当前 Gitea 用户',
    category: 'account',
    access: 'read',
    inputShape: {},
    handler: async (_input, ctx) => {
      const user = await ctx.operations.misc.getCurrentUser();
      // 版本一并交代：这个工具的定位就是「令牌 / 连通性 / 环境自查」，
      // 顺手把服务端版本与兼容性说清楚，省得用户另开一次提问。
      // 取不到版本不影响本工具（与 MCP 侧的兼容性探测同一态度）。
      const version = await ctx.operations.misc
        .getVersion()
        .then((info) => info.version)
        .catch(() => undefined);
      const text = [
        `# @${user.login}`,
        '',
        `- 昵称：${user.full_name ?? '-'}`,
        `- 邮箱：${user.email ?? '-'}`,
        `- 管理员：${user.is_admin ? '是' : '否'}`,
        `- 主页：${user.html_url ?? '-'}`,
        `- 注册时间：${relativeTime(user.created)}`,
        `- 实例：${ctx.serverUrl}`,
        `- 服务端版本：${compatibilityStatusLine(
          version === undefined ? undefined : evaluateCompatibility(version),
        )}`,
      ].join('\n');
      return { text, data: user };
    },
  }),

  defineTool({
    name: 'gitea_list_orgs',
    displayName: '列出组织',
    description: '列出当前用户所属或可见的 Gitea 组织。',
    userDescription: '列出 Gitea 组织',
    category: 'account',
    access: 'read',
    inputShape: {},
    handler: async (_input, ctx) => {
      const orgs = await ctx.operations.misc.listOrgs();
      if (orgs.length === 0) {
        return { text: '当前用户没有加入任何组织。', data: { items: [] } };
      }
      const lines = orgs.map(
        (org) => `- **${org.username}**${org.full_name ? `（${org.full_name}）` : ''}${org.description ? ` — ${org.description}` : ''}`,
      );
      return {
        text: `共 ${orgs.length} 个组织：\n${lines.join('\n')}`,
        data: { items: orgs },
      };
    },
  }),

  defineTool({
    name: 'gitea_list_notifications',
    displayName: '列出通知',
    description: '列出当前用户的 Gitea 通知线程，可按类型过滤。',
    userDescription: '列出 Gitea 通知',
    category: 'account',
    access: 'read',
    inputShape: {
      includeRead: z.boolean().optional().describe('是否包含已读通知，默认 false。'),
      subjectTypes: z
        .array(z.enum(['issue', 'pull', 'commit', 'repository']))
        .optional()
        .describe('仅关注的通知类型。'),
      limit: z.number().int().min(1).max(100).optional().describe('返回数量上限，默认 30。'),
    },
    handler: async (input, ctx) => {
      const result = await ctx.operations.misc.listNotifications({
        includeRead: input.includeRead,
        subjectTypes: input.subjectTypes,
        limit: input.limit ?? 30,
      });
      if (result.items.length === 0) {
        return { text: '没有通知。', data: { items: [] } };
      }
      const lines = result.items.map((thread) => {
        const repoName = thread.repository?.full_name ?? 'unknown';
        const subject = thread.subject;
        const state = thread.unread ? '未读' : '已读';
        return `- [${subject.type ?? 'unknown'}] **${repoName}** ${subject.title}（${state}，${relativeTime(thread.updated_at)}）${subject.html_url ? `\n  ${subject.html_url}` : ''}`;
      });
      return {
        text: `共 ${result.items.length} 条通知：\n${lines.join('\n')}`,
        data: { items: result.items },
      };
    },
  }),

  defineTool({
    name: 'gitea_mark_notifications_read',
    displayName: '标记通知已读',
    description: '把全部通知（或某个时间点之前的通知）标记为已读。',
    userDescription: '标记 Gitea 通知为已读',
    category: 'account',
    access: 'write',
    inputShape: {
      all: z.boolean().optional().describe('是否标记全部通知，默认 true。'),
      lastReadAt: z
        .string()
        .optional()
        .describe('仅标记该时间点之前的通知，ISO 8601 格式。设置后 `all` 失效。'),
    },
    handler: async (input, ctx) => {
      await ctx.operations.misc.markNotifications({
        all: input.lastReadAt ? false : input.all ?? true,
        lastReadAt: input.lastReadAt,
        toStatus: 'read',
      });
      return {
        text: input.lastReadAt ? `已把 ${input.lastReadAt} 之前的通知标记为已读。` : '已把全部通知标记为已读。',
      };
    },
  }),
];
