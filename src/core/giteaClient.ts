/**
 * Gitea API 客户端。
 *
 * 仅负责：URL 拼装、认证头注入、JSON 序列化/反序列化、错误归一化、分页信息解析。
 * 具体业务语义（Issue、PR、仓库等）位于 {@link ./operations.ts}。
 */
import { GiteaApiError, GiteaConfigError } from './errors';
import { httpRequest } from './http';
import type { GiteaPageInfo } from './types';

/** 客户端构造参数。 */
export interface GiteaClientOptions {
  /** 实例地址，例如 `https://gitea.example.com`。 */
  serverUrl: string;
  /** 个人访问令牌（`Authorization: token <token>`）。 */
  token?: string;
  /** 是否校验 TLS 证书。 */
  verifyTls?: boolean;
  /** 请求超时（毫秒）。 */
  timeoutMs?: number;
  /** User-Agent 标识。 */
  userAgent?: string;
}

/** 单次请求的可选项。 */
export interface RequestOptions {
  /** URL 查询参数。数组会展开为同名重复参数（Gitea 的 array 类型查询参数约定）。 */
  query?: Record<string, string | number | boolean | string[] | undefined | null>;
  /** 请求体对象，会被 JSON 序列化。 */
  body?: unknown;
  /** 期望的响应类型，默认 `json`。 */
  responseType?: 'json' | 'text';
  /** 覆盖默认超时。 */
  timeoutMs?: number;
  /** 取消信号。 */
  signal?: AbortSignal;
  /** 额外请求头。 */
  headers?: Record<string, string>;
}

/**
 * Gitea REST API 客户端。
 */
export class GiteaClient {
  /** 规范化后的实例地址（不含结尾斜杠）。 */
  public readonly serverUrl: string;

  private readonly token: string | undefined;
  private readonly verifyTls: boolean;
  private readonly timeoutMs: number;
  private readonly userAgent: string;

  constructor(options: GiteaClientOptions) {
    const normalized = (options.serverUrl ?? '').trim().replace(/\/+$/, '');
    if (normalized.length === 0) {
      throw new GiteaConfigError('未配置 Gitea 实例地址，请设置 gitea.serverUrl');
    }
    if (!/^https?:\/\//i.test(normalized)) {
      throw new GiteaConfigError(`Gitea 实例地址必须以 http:// 或 https:// 开头：${normalized}`);
    }
    this.serverUrl = normalized;
    this.token = options.token?.trim() || undefined;
    this.verifyTls = options.verifyTls !== false;
    this.timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : 20_000;
    this.userAgent = options.userAgent ?? 'gitea-toolkit-vscode';
  }

  /** 是否已配置访问令牌。 */
  public get hasToken(): boolean {
    return this.token !== undefined;
  }

  /**
   * 发起一次 API 请求。
   * @param method HTTP 方法
   * @param path API 路径（相对 `/api/v1`），例如 `/repos/o/r/issues`
   * @param options 请求选项
   * @returns 解析后的响应体
   */
  public async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const result = await this.requestWithMeta<T>(method, path, options);
    return result.data;
  }

  /**
   * 发起一次 API 请求，并返回分页元信息。
   * @param method HTTP 方法
   * @param path API 路径（相对 `/api/v1`）
   * @param options 请求选项
   * @returns 响应体与分页信息
   */
  public async requestWithMeta<T>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<{ data: T; pageInfo: GiteaPageInfo }> {
    const url = this.buildUrl(path, options.query);
    const endpoint = `${method.toUpperCase()} ${path}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': this.userAgent,
      ...options.headers,
    };
    if (this.token) {
      headers.Authorization = `token ${this.token}`;
    }
    let body: string | undefined;
    if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(body, 'utf8'));
    }

    const response = await httpRequest({
      url,
      method,
      headers,
      body,
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
      verifyTls: this.verifyTls,
      signal: options.signal,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new GiteaApiError(
        this.describeStatus(response.status),
        response.status,
        endpoint,
        response.body,
      );
    }

    const pageInfo = parsePageInfo(response.headers);
    const wantText = options.responseType === 'text';
    if (wantText || response.status === 204 || response.body.length === 0) {
      return { data: response.body as unknown as T, pageInfo };
    }

    try {
      return { data: JSON.parse(response.body) as T, pageInfo };
    } catch (error) {
      throw new GiteaApiError(
        `响应不是合法 JSON：${(error as Error).message}`,
        response.status,
        endpoint,
        response.body.slice(0, 500),
      );
    }
  }

  /**
   * 拼接完整请求 URL。
   * @param path API 路径
   * @param query 查询参数
   * @returns 完整 URL 字符串
   */
  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.serverUrl}/api/v1${normalizedPath}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === '') {
          continue;
        }
        if (Array.isArray(value)) {
          for (const item of value) {
            url.searchParams.append(key, String(item));
          }
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  /**
   * 为状态码生成人类可读描述。
   * @param status HTTP 状态码
   * @returns 描述文本
   */
  private describeStatus(status: number): string {
    switch (status) {
      case 401:
        return this.token ? '认证失败，访问令牌可能已失效或无权限' : '未配置访问令牌，请先执行「Gitea: 设置访问令牌」';
      case 403:
        return '权限不足，当前令牌没有执行该操作的权限';
      case 404:
        return '资源不存在，或当前令牌无权访问';
      case 409:
        return '操作冲突，目标资源状态已变更';
      case 422:
        return '请求参数校验失败';
      case 429:
        return '请求过于频繁，已触发限流';
      default:
        return `请求失败（HTTP ${status}）`;
    }
  }
}

/**
 * 从响应头解析分页信息。
 * @param headers 响应头
 * @returns 分页信息
 */
function parsePageInfo(headers: Record<string, unknown>): GiteaPageInfo {
  const rawTotal = headers['x-total-count'];
  const total = typeof rawTotal === 'string' ? Number.parseInt(rawTotal, 10) : Number.NaN;
  const link = typeof headers.link === 'string' ? headers.link : '';
  return {
    totalCount: Number.isFinite(total) ? total : undefined,
    hasNextPage: link.includes('rel="next"'),
  };
}
