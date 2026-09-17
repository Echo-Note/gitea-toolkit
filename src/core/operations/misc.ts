/**
 * 用户、组织、通知等辅助类 Gitea API 操作。
 */
import type { GiteaClient } from '../giteaClient';
import type {
  GiteaListResult,
  GiteaNotificationThread,
  GiteaOrganization,
  GiteaUser,
} from '../types';

/** 通知列表查询参数。 */
export interface ListNotificationsOptions {
  /** 是否包含已读通知。 */
  includeRead?: boolean;
  /** 仅关注的通知类型：`issue` / `pull` / `commit` / `repository`。 */
  subjectTypes?: Array<'issue' | 'pull' | 'commit' | 'repository'>;
  page?: number;
  limit?: number;
}

/** 用户 / 组织 / 通知操作集合。 */
export class MiscOperations {
  constructor(private readonly client: GiteaClient) {}

  /**
   * 获取当前令牌对应的用户（同时用于校验令牌有效性）。
   * @returns 当前用户
   */
  public getCurrentUser(): Promise<GiteaUser> {
    return this.client.request<GiteaUser>('GET', '/user');
  }

  /**
   * 列出当前用户所属（或可见）的组织。
   * @returns 组织列表
   */
  public async listOrgs(): Promise<GiteaOrganization[]> {
    const result = await this.client.requestWithMeta<GiteaOrganization[]>('GET', '/user/orgs', {
      query: { limit: 100 },
    });
    return result.data ?? [];
  }

  /**
   * 列出通知。
   * @param options 查询参数
   * @returns 通知线程列表
   */
  public async listNotifications(
    options: ListNotificationsOptions = {},
  ): Promise<GiteaListResult<GiteaNotificationThread>> {
    const result = await this.client.requestWithMeta<GiteaNotificationThread[]>('GET', '/notifications', {
      query: {
        all: options.includeRead ? 'true' : undefined,
        'status-types': options.includeRead ? ['unread', 'read', 'pinned'] : ['unread', 'pinned'],
        'subject-type': options.subjectTypes,
        page: options.page ?? 1,
        limit: options.limit ?? 50,
      },
    });
    return { items: result.data ?? [], pageInfo: result.pageInfo };
  }

  /**
   * 将单条通知线程标记为已读。
   * @param threadId 线程 ID
   */
  public async markThreadRead(threadId: number): Promise<void> {
    await this.client.request('PATCH', `/notifications/threads/${threadId}`, {
      body: { to_status: 'read' },
    });
  }

  /**
   * 批量标记通知状态。Gitea 该接口通过查询参数传参。
   * @param options 标记参数
   */
  public async markNotifications(options: {
    /** 全部标记（忽略 `lastReadAt`）。 */
    all?: boolean;
    /** 仅标记该时间点之前的通知。 */
    lastReadAt?: string;
    /** 目标状态。 */
    toStatus?: 'read' | 'unread' | 'pinned';
    /** 参与标记的状态类型。 */
    statusTypes?: Array<'unread' | 'read' | 'pinned'>;
  }): Promise<void> {
    await this.client.request('PUT', '/notifications', {
      query: {
        all: options.all ? 'true' : undefined,
        last_read_at: options.lastReadAt,
        'to-status': options.toStatus ?? 'read',
        'status-types': options.statusTypes ?? ['unread', 'pinned'],
      },
    });
  }

  /**
   * 获取实例版本信息（用于连通性探测与兼容性提示）。
   * @returns 版本字符串
   */
  public getVersion(): Promise<{ version: string }> {
    return this.client.request<{ version: string }>('GET', '/version');
  }

  /**
   * 调用服务端渲染 Markdown 为 HTML。
   *
   * 复用 Gitea 自身的渲染器，保证详情面板的展示与网页端完全一致
   * （任务列表、@提及、Issue 引用、代码高亮等行为都相同）。
   * @param text Markdown 原文
   * @param options 渲染选项
   * @returns 渲染后的 HTML 片段
   */
  public renderMarkdown(
    text: string,
    options: {
      /** 渲染上下文路径，用于解析相对链接与媒体，例如 `/owner/repo/src/main`。 */
      context?: string;
      /** 渲染模式，默认 `comment`（与网页端评论一致）。 */
      mode?: 'markdown' | 'comment' | 'wiki' | 'file';
    } = {},
  ): Promise<string> {
    return this.client.request<string>('POST', '/markdown', {
      body: {
        Text: text,
        Mode: options.mode ?? 'comment',
        Context: options.context,
      },
      responseType: 'text',
    });
  }
}
