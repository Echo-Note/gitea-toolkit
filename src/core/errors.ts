/**
 * 核心层错误类型。
 *
 * 所有错误均保留上下文（端点、HTTP 状态、响应片段），便于向用户或 AI Agent 反馈可操作的信息。
 */

/** Gitea API 调用失败（HTTP 非 2xx，或响应体不符合预期）。 */
export class GiteaApiError extends Error {
  /** HTTP 状态码；网络层失败时为 0。 */
  public readonly status: number;
  /** 请求方法与路径，例如 `POST /repos/o/r/issues`。 */
  public readonly endpoint: string;
  /** 服务端返回的原始响应体（已截断）。 */
  public readonly responseBody: string | undefined;

  constructor(message: string, status: number, endpoint: string, responseBody?: string) {
    super(message);
    this.name = 'GiteaApiError';
    this.status = status;
    this.endpoint = endpoint;
    this.responseBody = responseBody;
  }

  /** 是否为「未认证 / 令牌失效」类错误。 */
  public get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }

  /** 是否为「资源不存在」类错误。 */
  public get isNotFound(): boolean {
    return this.status === 404;
  }
}

/** 配置缺失或非法（例如未填写服务器地址）。 */
export class GiteaConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GiteaConfigError';
  }
}

/**
 * 将任意异常统一转换为可读的错误消息。
 * @param error 待转换的异常
 * @returns 人类可读的错误描述
 */
export function describeError(error: unknown): string {
  if (error instanceof GiteaApiError) {
    const detail = extractServerMessage(error.responseBody);
    const base = `${error.endpoint} 调用失败（HTTP ${error.status}）`;
    return detail ? `${base}：${detail}` : base;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * 从 Gitea 的错误响应中提取 `message` 字段。
 * @param body 原始响应体
 * @returns 服务端错误消息；无法解析时返回 undefined
 */
function extractServerMessage(body: string | undefined): string | undefined {
  if (!body) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === 'string' && parsed.message.trim().length > 0) {
      return parsed.message.trim();
    }
  } catch {
    // 非 JSON 响应，退回原文
  }
  const trimmed = body.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 300) : undefined;
}
