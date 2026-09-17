/**
 * 仓库相关的 Gitea API 操作。所有 UI 与 AI 工具均通过本模块访问仓库数据。
 */
import { GiteaApiError } from '../errors';
import type { GiteaClient } from '../giteaClient';
import { decodeBase64, encodeBase64, encodeRepoPath, looksLikeBase64 } from '../encoding';
import type {
  GiteaBranch,
  GiteaCombinedStatus,
  GiteaCommit,
  GiteaContentsResponse,
  GiteaFileResponse,
  GiteaListResult,
  GiteaRepository,
} from '../types';

/** 仓库列表查询参数。 */
export interface ListReposOptions {
  /** 指定组织或用户名；`mine=true` 时忽略。 */
  owner?: string;
  /** 关键词搜索。设置后走 `/repos/search`。 */
  search?: string;
  /** 仅列出当前用户拥有的仓库。 */
  mine?: boolean;
  /** 页码，从 1 开始。 */
  page?: number;
  /** 每页数量。 */
  limit?: number;
  /** 排序字段。 */
  sort?: 'alpha' | 'created' | 'updated' | 'size' | 'id';
  /** 排序方向。 */
  order?: 'asc' | 'desc';
}

/** 创建仓库参数。 */
export interface CreateRepoOptions {
  /** 仓库名（必填）。 */
  name: string;
  /** 所属组织；为空时创建到当前用户名下。 */
  owner?: string;
  /** 仓库描述。 */
  description?: string;
  /** 是否私有。 */
  private?: boolean;
  /** 是否自动初始化（创建 README）。 */
  autoInit?: boolean;
  /** 默认分支名。 */
  defaultBranch?: string;
  /** README 模板，例如 `Default`。 */
  readme?: string;
  /** .gitignore 模板名。 */
  gitignores?: string;
  /** 许可证模板名。 */
  license?: string;
  /** 是否为模板仓库。 */
  template?: boolean;
}

/** 列出提交的参数。 */
export interface ListCommitsOptions {
  /** 分支 / 标签 / 提交 SHA。 */
  ref?: string;
  /** 仅列出影响该路径的提交。 */
  path?: string;
  /** 是否返回文件变更明细。 */
  withFiles?: boolean;
  page?: number;
  limit?: number;
}

/** 读取文件内容的返回结构。 */
export interface RepoFileContent {
  /** 仓库内路径。 */
  path: string;
  /** 文件 blob SHA（更新文件时必需）。 */
  sha: string;
  /** 解码后的文本内容。 */
  content: string;
  /** 文件大小（字节）。 */
  size: number;
  /** 内容是否被截断。 */
  truncated: boolean;
}

/** 提交文件（创建或更新）的参数。 */
export interface CommitFileOptions {
  /** 文件内容（纯文本，内部会自动 base64）。 */
  content: string;
  /** 提交信息。 */
  message?: string;
  /** 目标分支。 */
  branch?: string;
  /** 设定后会在该新分支上提交。 */
  newBranch?: string;
  /** 已知的 blob SHA；提供则执行更新，否则先查询后决定。 */
  sha?: string;
  /** 作者信息。 */
  author?: { name: string; email: string };
}

/** 仓库操作集合。 */
export class RepoOperations {
  constructor(private readonly client: GiteaClient) {}

  /**
   * 列出仓库。
   * @param options 查询参数
   * @returns 仓库列表与分页信息
   */
  public async list(options: ListReposOptions = {}): Promise<GiteaListResult<GiteaRepository>> {
    const page = options.page ?? 1;
    const limit = options.limit ?? 50;

    if (options.search) {
      const result = await this.client.requestWithMeta<unknown>('GET', '/repos/search', {
        query: { q: options.search, page, limit, sort: options.sort, order: options.order },
      });
      return { items: unwrapSearchResults<GiteaRepository>(result.data), pageInfo: result.pageInfo };
    }

    const owner = options.owner?.trim();
    if (owner && !options.mine) {
      const path = await this.resolveOwnerReposPath(owner);
      const result = await this.client.requestWithMeta<GiteaRepository[]>('GET', path, {
        query: { page, limit },
      });
      return { items: result.data ?? [], pageInfo: result.pageInfo };
    }

    const result = await this.client.requestWithMeta<GiteaRepository[]>('GET', '/user/repos', {
      query: { page, limit },
    });
    return { items: result.data ?? [], pageInfo: result.pageInfo };
  }

  /**
   * 获取单个仓库。
   * @param owner 所属者
   * @param repo 仓库名
   * @returns 仓库详情
   */
  public get(owner: string, repo: string): Promise<GiteaRepository> {
    return this.client.request<GiteaRepository>('GET', `/repos/${enc(owner)}/${enc(repo)}`);
  }

  /**
   * 创建仓库。
   * @param options 创建参数
   * @returns 新建的仓库
   */
  public create(options: CreateRepoOptions): Promise<GiteaRepository> {
    const body: Record<string, unknown> = { name: options.name };
    if (options.description !== undefined) body.description = options.description;
    if (options.private !== undefined) body.private = options.private;
    if (options.autoInit !== undefined) body.auto_init = options.autoInit;
    if (options.defaultBranch !== undefined) body.default_branch = options.defaultBranch;
    if (options.readme !== undefined) body.readme = options.readme;
    if (options.gitignores !== undefined) body.gitignores = options.gitignores;
    if (options.license !== undefined) body.license = options.license;
    if (options.template !== undefined) body.template = options.template;

    const owner = options.owner?.trim();
    const path = owner ? `/orgs/${enc(owner)}/repos` : '/user/repos';
    return this.client.request<GiteaRepository>('POST', path, { body });
  }

  /**
   * 列出分支。
   * @param owner 所属者
   * @param repo 仓库名
   * @param page 页码
   * @param limit 每页数量
   * @returns 分支列表
   */
  public async listBranches(
    owner: string,
    repo: string,
    page = 1,
    limit = 50,
  ): Promise<GiteaListResult<GiteaBranch>> {
    const result = await this.client.requestWithMeta<GiteaBranch[]>(
      'GET',
      `/repos/${enc(owner)}/${enc(repo)}/branches`,
      { query: { page, limit } },
    );
    return { items: result.data ?? [], pageInfo: result.pageInfo };
  }

  /**
   * 创建分支。
   * @param owner 所属者
   * @param repo 仓库名
   * @param newBranch 新分支名
   * @param oldRef 源分支 / 标签 / 提交，缺省为仓库默认分支
   * @returns 新建的分支
   */
  public createBranch(
    owner: string,
    repo: string,
    newBranch: string,
    oldRef?: string,
  ): Promise<GiteaBranch> {
    const body: Record<string, unknown> = { new_branch_name: newBranch };
    if (oldRef) {
      body.old_ref_name = oldRef;
      body.old_branch_name = oldRef;
    }
    return this.client.request<GiteaBranch>('POST', `/repos/${enc(owner)}/${enc(repo)}/branches`, { body });
  }

  /**
   * 列出提交。
   * @param owner 所属者
   * @param repo 仓库名
   * @param options 查询参数
   * @returns 提交列表
   */
  public async listCommits(
    owner: string,
    repo: string,
    options: ListCommitsOptions = {},
  ): Promise<GiteaListResult<GiteaCommit>> {
    const result = await this.client.requestWithMeta<GiteaCommit[]>(
      'GET',
      `/repos/${enc(owner)}/${enc(repo)}/commits`,
      {
        query: {
          sha: options.ref,
          path: options.path,
          stat: options.withFiles ? 'true' : undefined,
          page: options.page ?? 1,
          limit: options.limit ?? 30,
        },
      },
    );
    return { items: result.data ?? [], pageInfo: result.pageInfo };
  }

  /**
   * 读取仓库内文件或目录。
   * @param owner 所属者
   * @param repo 仓库名
   * @param filePath 仓库内路径，空字符串表示根目录
   * @param ref 分支 / 标签 / 提交
   * @returns 目录条目数组或单个文件元数据
   */
  public getContents(
    owner: string,
    repo: string,
    filePath = '',
    ref?: string,
  ): Promise<GiteaContentsResponse | GiteaContentsResponse[]> {
    const path = encodeRepoPath(filePath);
    return this.client.request<GiteaContentsResponse | GiteaContentsResponse[]>(
      'GET',
      `/repos/${enc(owner)}/${enc(repo)}/contents${path ? `/${path}` : ''}`,
      { query: { ref } },
    );
  }

  /**
   * 读取文本文件内容，自动处理 base64 解码与大小截断。
   * @param owner 所属者
   * @param repo 仓库名
   * @param filePath 仓库内路径
   * @param ref 分支 / 标签 / 提交
   * @param maxBytes 最大读取字节数，默认 200KB
   * @returns 文件内容
   */
  public async getFileContent(
    owner: string,
    repo: string,
    filePath: string,
    ref?: string,
    maxBytes = 200_000,
  ): Promise<RepoFileContent> {
    const entry = await this.getContents(owner, repo, filePath, ref);
    if (Array.isArray(entry)) {
      throw new GiteaApiError(`路径 ${filePath} 是目录而非文件`, 400, 'GET contents', undefined);
    }
    const raw = entry.content ?? '';
    const content = entry.encoding === 'base64' || looksLikeBase64(raw) ? decodeBase64(raw) : raw;
    const truncated = content.length > maxBytes;
    return {
      path: entry.path,
      sha: entry.sha,
      content: truncated ? content.slice(0, maxBytes) : content,
      size: entry.size ?? Buffer.byteLength(content, 'utf8'),
      truncated,
    };
  }

  /**
   * 创建或更新文件并提交。
   * 未显式提供 `sha` 时会先查询目标文件是否存在，以决定走 POST（新建）还是 PUT（更新）。
   * @param owner 所属者
   * @param repo 仓库名
   * @param filePath 仓库内路径
   * @param options 提交参数
   * @returns 提交结果
   */
  public async commitFile(
    owner: string,
    repo: string,
    filePath: string,
    options: CommitFileOptions,
  ): Promise<GiteaFileResponse> {
    const path = encodeRepoPath(filePath);
    const endpoint = `/repos/${enc(owner)}/${enc(repo)}/contents/${path}`;
    const body: Record<string, unknown> = {
      content: encodeBase64(options.content),
      message: options.message ?? (options.sha ? `Update ${filePath}` : `Add ${filePath}`),
    };
    if (options.branch) body.branch = options.branch;
    if (options.newBranch) body.new_branch = options.newBranch;
    if (options.author) body.author = options.author;

    let sha = options.sha;
    if (sha === undefined) {
      sha = await this.findBlobSha(owner, repo, filePath, options.branch);
    }

    if (sha) {
      body.sha = sha;
      return this.client.request<GiteaFileResponse>('PUT', endpoint, { body });
    }
    return this.client.request<GiteaFileResponse>('POST', endpoint, { body });
  }

  /**
   * 获取某个提交 / 分支的合并状态（CI 汇总）。
   * @param owner 所属者
   * @param repo 仓库名
   * @param ref 分支 / 标签 / 提交 SHA
   * @returns 合并状态
   */
  public getCombinedStatus(owner: string, repo: string, ref: string): Promise<GiteaCombinedStatus> {
    return this.client.request<GiteaCombinedStatus>(
      'GET',
      `/repos/${enc(owner)}/${enc(repo)}/commits/${enc(ref)}/status`,
    );
  }

  /**
   * 查询文件当前的 blob SHA；文件不存在时返回 undefined。
   * @param owner 所属者
   * @param repo 仓库名
   * @param filePath 仓库内路径
   * @param ref 分支 / 标签 / 提交
   * @returns blob SHA 或 undefined
   */
  private async findBlobSha(
    owner: string,
    repo: string,
    filePath: string,
    ref?: string,
  ): Promise<string | undefined> {
    try {
      const entry = await this.getContents(owner, repo, filePath, ref);
      return Array.isArray(entry) ? undefined : entry.sha;
    } catch (error) {
      if (error instanceof GiteaApiError && error.isNotFound) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * 判断给定名称是组织还是用户，返回对应的仓库列表端点。
   * @param owner 组织或用户名
   * @returns API 路径
   */
  private async resolveOwnerReposPath(owner: string): Promise<string> {
    try {
      await this.client.request<unknown>('GET', `/orgs/${enc(owner)}`);
      return `/orgs/${enc(owner)}/repos`;
    } catch (error) {
      if (error instanceof GiteaApiError && error.isNotFound) {
        return `/users/${enc(owner)}/repos`;
      }
      throw error;
    }
  }
}

/** URL 路径片段编码。 */
function enc(value: string): string {
  return encodeURIComponent(value);
}

/**
 * 兼容 `/repos/search` 的两种响应形态：`{ok, data}` 与裸数组。
 * @param payload 原始响应
 * @returns 结果数组
 */
function unwrapSearchResults<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }
  if (payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)) {
    return (payload as { data: T[] }).data;
  }
  return [];
}
