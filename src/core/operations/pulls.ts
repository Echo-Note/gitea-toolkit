/**
 * Pull Request 相关的 Gitea API 操作。
 */
import type { GiteaClient } from '../giteaClient';
import type {
  GiteaChangedFile,
  GiteaIssueState,
  GiteaListResult,
  GiteaPullRequest,
  GiteaPullReview,
} from '../types';

/** PR 列表查询参数。 */
export interface ListPullsOptions {
  owner: string;
  repo: string;
  state?: GiteaIssueState;
  /** 排序：`oldest` / `recentupdate` / `leastupdate` / `mostcomment` / `leastcomment` / `priority`。 */
  sort?: string;
  /** 源分支过滤。 */
  head?: string;
  /** 目标分支过滤。 */
  base?: string;
  labels?: string;
  milestone?: number;
  page?: number;
  limit?: number;
}

/** 创建 PR 参数。 */
export interface CreatePullOptions {
  title: string;
  /** 源分支，可为 `owner:branch` 形式。 */
  head: string;
  /** 目标分支。 */
  base: string;
  body?: string;
  assignees?: string[];
  reviewers?: string[];
  teamReviewers?: string[];
  labels?: number[];
  milestone?: number;
  allowMaintainerEdit?: boolean;
}

/** 合并 PR 参数。 */
export interface MergePullOptions {
  /** 合并方式，默认 `merge`。 */
  strategy?: 'merge' | 'rebase' | 'rebase-merge' | 'squash' | 'fast-forward-only' | 'manually-merged';
  /** 合并后删除源分支。 */
  deleteBranchAfterMerge?: boolean;
  /** 强制合并（忽略分支保护）。 */
  forceMerge?: boolean;
  /** 自定义合并标题。 */
  mergeTitle?: string;
  /** 自定义合并提交信息。 */
  mergeMessage?: string;
  /** 校验通过后自动合并。 */
  mergeWhenChecksSucceed?: boolean;
  /** 目标提交 SHA，用于防止并发变更。 */
  headCommitId?: string;
}

/** 评审 PR 参数。 */
export interface ReviewPullOptions {
  /** 评审动作。 */
  event: 'APPROVED' | 'COMMENT' | 'REQUEST_CHANGES';
  /** 评审正文。 */
  body?: string;
  /** 关联的提交 SHA，缺省由服务端取最新。 */
  commitId?: string;
}

/** Pull Request 操作集合。 */
export class PullOperations {
  constructor(private readonly client: GiteaClient) {}

  /**
   * 列出 PR。
   * @param options 查询参数
   * @returns PR 列表
   */
  public async list(options: ListPullsOptions): Promise<GiteaListResult<GiteaPullRequest>> {
    const result = await this.client.requestWithMeta<GiteaPullRequest[]>(
      'GET',
      `/repos/${enc(options.owner)}/${enc(options.repo)}/pulls`,
      {
        query: {
          state: options.state ?? 'open',
          sort: options.sort,
          head: options.head,
          base: options.base,
          labels: options.labels,
          milestone: options.milestone,
          page: options.page ?? 1,
          limit: options.limit ?? 50,
        },
      },
    );
    return { items: result.data ?? [], pageInfo: result.pageInfo };
  }

  /**
   * 获取单个 PR。
   * @param owner 所属者
   * @param repo 仓库名
   * @param index PR 序号
   * @returns PR 详情
   */
  public get(owner: string, repo: string, index: number): Promise<GiteaPullRequest> {
    return this.client.request<GiteaPullRequest>('GET', `/repos/${enc(owner)}/${enc(repo)}/pulls/${index}`);
  }

  /**
   * 创建 PR。
   * @param owner 所属者
   * @param repo 仓库名
   * @param options 创建参数
   * @returns 新建的 PR
   */
  public create(owner: string, repo: string, options: CreatePullOptions): Promise<GiteaPullRequest> {
    const body: Record<string, unknown> = {
      title: options.title,
      head: options.head,
      base: options.base,
    };
    if (options.body !== undefined) body.body = options.body;
    if (options.assignees?.length) body.assignees = options.assignees;
    if (options.reviewers?.length) body.reviewers = options.reviewers;
    if (options.teamReviewers?.length) body.team_reviewers = options.teamReviewers;
    if (options.labels?.length) body.labels = options.labels;
    if (options.milestone !== undefined) body.milestone = options.milestone;
    if (options.allowMaintainerEdit !== undefined) body.allow_maintainer_edit = options.allowMaintainerEdit;
    return this.client.request<GiteaPullRequest>('POST', `/repos/${enc(owner)}/${enc(repo)}/pulls`, { body });
  }

  /**
   * 获取 PR 的文本差异（unified diff）。
   * @param owner 所属者
   * @param repo 仓库名
   * @param index PR 序号
   * @param format `diff` 或 `patch`
   * @returns diff 文本
   */
  public getDiff(
    owner: string,
    repo: string,
    index: number,
    format: 'diff' | 'patch' = 'diff',
  ): Promise<string> {
    return this.client.request<string>(
      'GET',
      `/repos/${enc(owner)}/${enc(repo)}/pulls/${index}.${format}`,
      { responseType: 'text' },
    );
  }

  /**
   * 获取 PR 变更文件清单。
   * @param owner 所属者
   * @param repo 仓库名
   * @param index PR 序号
   * @returns 变更文件列表
   */
  public async listFiles(owner: string, repo: string, index: number): Promise<GiteaChangedFile[]> {
    const result = await this.client.requestWithMeta<GiteaChangedFile[]>(
      'GET',
      `/repos/${enc(owner)}/${enc(repo)}/pulls/${index}/files`,
      { query: { limit: 300 } },
    );
    return result.data ?? [];
  }

  /**
   * 合并 PR。
   * @param owner 所属者
   * @param repo 仓库名
   * @param index PR 序号
   * @param options 合并参数
   * @returns 合并结果（服务端可能返回空响应体）
   */
  public async merge(
    owner: string,
    repo: string,
    index: number,
    options: MergePullOptions = {},
  ): Promise<{ merged: boolean; message: string }> {
    const body: Record<string, unknown> = { do: options.strategy ?? 'merge' };
    if (options.deleteBranchAfterMerge !== undefined) {
      body.delete_branch_after_merge = options.deleteBranchAfterMerge;
    }
    if (options.forceMerge !== undefined) body.force_merge = options.forceMerge;
    if (options.mergeTitle) body.merge_title_field = options.mergeTitle;
    if (options.mergeMessage) body.merge_message_field = options.mergeMessage;
    if (options.mergeWhenChecksSucceed !== undefined) {
      body.merge_when_checks_succeed = options.mergeWhenChecksSucceed;
    }
    if (options.headCommitId) body.head_commit_id = options.headCommitId;

    await this.client.request('POST', `/repos/${enc(owner)}/${enc(repo)}/pulls/${index}/merge`, { body });
    return { merged: true, message: `PR #${index} 已按 ${String(body.do)} 方式合并` };
  }

  /**
   * 更新 PR（标题 / 正文 / 状态 / 指派 / 目标分支）。
   * @param owner 所属者
   * @param repo 仓库名
   * @param index PR 序号
   * @param options 更新参数
   * @returns 更新后的 PR
   */
  public update(
    owner: string,
    repo: string,
    index: number,
    options: {
      title?: string;
      body?: string;
      state?: 'open' | 'closed';
      assignees?: string[];
      base?: string;
    },
  ): Promise<GiteaPullRequest> {
    const body: Record<string, unknown> = {};
    if (options.title !== undefined) body.title = options.title;
    if (options.body !== undefined) body.body = options.body;
    if (options.state !== undefined) body.state = options.state;
    if (options.assignees !== undefined) body.assignees = options.assignees;
    if (options.base !== undefined) body.base = options.base;
    return this.client.request<GiteaPullRequest>(
      'PATCH',
      `/repos/${enc(owner)}/${enc(repo)}/pulls/${index}`,
      { body },
    );
  }

  /**
   * 列出 PR 的评审记录。
   * @param owner 所属者
   * @param repo 仓库名
   * @param index PR 序号
   * @returns 评审列表
   */
  public async listReviews(owner: string, repo: string, index: number): Promise<GiteaPullReview[]> {
    const result = await this.client.requestWithMeta<GiteaPullReview[]>(
      'GET',
      `/repos/${enc(owner)}/${enc(repo)}/pulls/${index}/reviews`,
      { query: { limit: 100 } },
    );
    return result.data ?? [];
  }

  /**
   * 提交 PR 评审（批准 / 请求修改 / 评论）。
   * @param owner 所属者
   * @param repo 仓库名
   * @param index PR 序号
   * @param options 评审参数
   * @returns 评审结果
   */
  public createReview(
    owner: string,
    repo: string,
    index: number,
    options: ReviewPullOptions,
  ): Promise<GiteaPullReview> {
    const body: Record<string, unknown> = { event: options.event };
    if (options.body !== undefined) body.body = options.body;
    if (options.commitId) body.commit_id = options.commitId;
    return this.client.request<GiteaPullReview>(
      'POST',
      `/repos/${enc(owner)}/${enc(repo)}/pulls/${index}/reviews`,
      { body },
    );
  }

}

/** URL 路径片段编码。 */
function enc(value: string): string {
  return encodeURIComponent(value);
}
