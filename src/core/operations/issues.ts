/**
 * Issue 相关的 Gitea API 操作（Gitea 中 Issue 与 PR 共用底层表，此处只处理 Issue）。
 */
import type { GiteaClient } from '../giteaClient';
import type {
  GiteaComment,
  GiteaIssue,
  GiteaIssueSearchType,
  GiteaIssueState,
  GiteaLabel,
  GiteaListResult,
} from '../types';

/** Issue 列表查询参数。 */
export interface ListIssuesOptions {
  /** 限定仓库所属者；与 `repo` 同时提供时走单仓库接口。 */
  owner?: string;
  /** 限定仓库名；与 `owner` 同时提供时走单仓库接口。 */
  repo?: string;
  /** 状态筛选，默认 `open`。 */
  state?: GiteaIssueState;
  /** 条目类型：issue 或 pull。默认 issues。 */
  type?: GiteaIssueSearchType;
  /** 关键词。 */
  search?: string;
  /** 标签名，逗号分隔。 */
  labels?: string;
  /** 里程碑名，逗号分隔。 */
  milestones?: string;
  /** 只看分配给我的。 */
  assignedToMe?: boolean;
  /** 只看我创建的。 */
  createdByMe?: boolean;
  /** 只看提及我的。 */
  mentionedMe?: boolean;
  /** 只看请求我评审的（PR）。 */
  reviewRequestedMe?: boolean;
  /** 只看我评审过的（PR）。 */
  reviewedByMe?: boolean;
  /** 排序字段：`created` / `updated` / `comments` / `due_date`（仅单仓库接口支持）。 */
  sort?: string;
  page?: number;
  limit?: number;
}

/** 创建 Issue 参数。 */
export interface CreateIssueOptions {
  /** 标题（必填）。 */
  title: string;
  /** 正文（Markdown）。 */
  body?: string;
  /** 指派用户。 */
  assignees?: string[];
  /** 标签 ID 列表。 */
  labels?: number[];
  /** 里程碑 ID。 */
  milestone?: number;
  /** 截止日期，ISO 8601。 */
  dueDate?: string;
  /** 直接以关闭状态创建。 */
  closed?: boolean;
  /** 关联的分支名。 */
  ref?: string;
}

/** 更新 Issue 参数。 */
export interface UpdateIssueOptions {
  title?: string;
  body?: string;
  /** `open` 或 `closed`。 */
  state?: 'open' | 'closed';
  assignees?: string[];
  labels?: number[];
  milestone?: number;
  dueDate?: string;
  /** 清除截止日期。 */
  unsetDueDate?: boolean;
}

/** Issue 操作集合。 */
export class IssueOperations {
  constructor(private readonly client: GiteaClient) {}

  /**
   * 列出 Issue（可按仓库或全局检索）。
   * @param options 查询参数
   * @returns Issue 列表与分页信息
   */
  public async list(options: ListIssuesOptions = {}): Promise<GiteaListResult<GiteaIssue>> {
    // 走 requestPaged：服务端单页上限为 max_response_items（默认 50），
    // 想要更多必须真的翻页，只调大 limit 会被静默截断。
    const state = options.state ?? 'open';
    const limit = options.limit ?? 50;
    const startPage = options.page ?? 1;

    if (options.owner && options.repo) {
      return this.client.requestPaged<GiteaIssue>(
        'GET',
        `/repos/${enc(options.owner)}/${enc(options.repo)}/issues`,
        {
          limit,
          startPage,
          extract: (data) => (data as GiteaIssue[]) ?? [],
          query: {
            state,
            type: options.type,
            q: options.search,
            labels: options.labels,
            milestones: options.milestones,
            sort: options.sort,
          },
        },
      );
    }

    return this.client.requestPaged<GiteaIssue>('GET', '/repos/issues/search', {
      limit,
      startPage,
      extract: (data) => (data as GiteaIssue[]) ?? [],
      query: {
        state,
        type: options.type,
        q: options.search,
        labels: options.labels,
        milestones: options.milestones,
        assigned: options.assignedToMe ? 'true' : undefined,
        created: options.createdByMe ? 'true' : undefined,
        mentioned: options.mentionedMe ? 'true' : undefined,
        review_requested: options.reviewRequestedMe ? 'true' : undefined,
        reviewed: options.reviewedByMe ? 'true' : undefined,
        owner: options.owner,
      },
    });
  }

  /**
   * 获取单个 Issue。
   * @param owner 所属者
   * @param repo 仓库名
   * @param index Issue 序号（`number`）
   * @returns Issue 详情
   */
  public get(owner: string, repo: string, index: number): Promise<GiteaIssue> {
    return this.client.request<GiteaIssue>('GET', `/repos/${enc(owner)}/${enc(repo)}/issues/${index}`);
  }

  /**
   * 创建 Issue。
   * @param owner 所属者
   * @param repo 仓库名
   * @param options 创建参数
   * @returns 新建的 Issue
   */
  public create(owner: string, repo: string, options: CreateIssueOptions): Promise<GiteaIssue> {
    const body: Record<string, unknown> = { title: options.title };
    if (options.body !== undefined) body.body = options.body;
    if (options.assignees?.length) body.assignees = options.assignees;
    if (options.labels?.length) body.labels = options.labels;
    if (options.milestone !== undefined) body.milestone = options.milestone;
    if (options.dueDate) body.due_date = options.dueDate;
    if (options.closed !== undefined) body.closed = options.closed;
    if (options.ref) body.ref = options.ref;
    return this.client.request<GiteaIssue>('POST', `/repos/${enc(owner)}/${enc(repo)}/issues`, { body });
  }

  /**
   * 更新 Issue（标题 / 正文 / 状态 / 指派 / 标签 / 里程碑）。
   * @param owner 所属者
   * @param repo 仓库名
   * @param index Issue 序号
   * @param options 更新参数
   * @returns 更新后的 Issue
   */
  public update(
    owner: string,
    repo: string,
    index: number,
    options: UpdateIssueOptions,
  ): Promise<GiteaIssue> {
    const body: Record<string, unknown> = {};
    if (options.title !== undefined) body.title = options.title;
    if (options.body !== undefined) body.body = options.body;
    if (options.state !== undefined) body.state = options.state;
    if (options.assignees !== undefined) body.assignees = options.assignees;
    if (options.labels !== undefined) body.labels = options.labels;
    if (options.milestone !== undefined) body.milestone = options.milestone;
    if (options.dueDate !== undefined) body.due_date = options.dueDate;
    if (options.unsetDueDate) body.unset_due_date = true;
    return this.client.request<GiteaIssue>('PATCH', `/repos/${enc(owner)}/${enc(repo)}/issues/${index}`, { body });
  }

  /**
   * 列出 Issue 的评论。
   * @param owner 所属者
   * @param repo 仓库名
   * @param index Issue 序号
   * @param page 页码
   * @param limit 每页数量
   * @returns 评论列表
   */
  public async listComments(
    owner: string,
    repo: string,
    index: number,
    page = 1,
    limit = 50,
  ): Promise<GiteaListResult<GiteaComment>> {
    const result = await this.client.requestWithMeta<GiteaComment[]>(
      'GET',
      `/repos/${enc(owner)}/${enc(repo)}/issues/${index}/comments`,
      { query: { page, limit } },
    );
    return { items: result.data ?? [], pageInfo: result.pageInfo };
  }

  /**
   * 在 Issue 下发表评论。
   * @param owner 所属者
   * @param repo 仓库名
   * @param index Issue 序号
   * @param body 评论正文（Markdown）
   * @returns 新建的评论
   */
  public createComment(owner: string, repo: string, index: number, body: string): Promise<GiteaComment> {
    return this.client.request<GiteaComment>(
      'POST',
      `/repos/${enc(owner)}/${enc(repo)}/issues/${index}/comments`,
      { body: { body } },
    );
  }

  /**
   * 列出仓库标签（供创建 Issue 时选择）。
   * @param owner 所属者
   * @param repo 仓库名
   * @returns 标签列表
   */
  public async listLabels(owner: string, repo: string): Promise<GiteaLabel[]> {
    const result = await this.client.requestWithMeta<GiteaLabel[]>(
      'GET',
      `/repos/${enc(owner)}/${enc(repo)}/labels`,
      { query: { limit: 200 } },
    );
    return result.data ?? [];
  }

}

/** URL 路径片段编码。 */
function enc(value: string): string {
  return encodeURIComponent(value);
}
