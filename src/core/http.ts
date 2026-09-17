/**
 * 极简 HTTP 客户端（基于 node:http / node:https）。
 *
 * 之所以不直接用全局 fetch：内网 Gitea 常使用自签名证书，
 * 需要按请求关闭 TLS 校验（`verifyTls=false`），而 Node 内置 fetch 无法在不引入
 * undici 调度器的情况下做到这一点。该实现同时提供统一的超时、重定向与中止语义。
 */
import * as http from 'node:http';
import * as https from 'node:https';
import { URL } from 'node:url';

/** 一次 HTTP 请求的参数。 */
export interface HttpRequestOptions {
  /** 完整 URL。 */
  url: string;
  /** HTTP 方法，默认 GET。 */
  method?: string;
  /** 请求头。 */
  headers?: Record<string, string>;
  /** 请求体（字符串）。 */
  body?: string;
  /** 超时毫秒数，默认 20000。 */
  timeoutMs?: number;
  /** 是否校验 TLS 证书，默认 true。 */
  verifyTls?: boolean;
  /** 用于取消请求。 */
  signal?: AbortSignal;
}

/** HTTP 响应。 */
export interface HttpResponse {
  /** 状态码。 */
  status: number;
  /** 响应头。 */
  headers: http.IncomingHttpHeaders;
  /** 响应体文本。 */
  body: string;
}

/** 最大重定向跟随次数。 */
const MAX_REDIRECTS = 5;

/**
 * 发起一次 HTTP(S) 请求。
 * @param options 请求参数
 * @returns 响应对象（不抛错，非 2xx 也正常返回，由调用方判定）
 */
export async function httpRequest(options: HttpRequestOptions): Promise<HttpResponse> {
  let currentUrl = options.url;
  let currentMethod = (options.method ?? 'GET').toUpperCase();
  let currentBody = options.body;
  let currentHeaders = { ...(options.headers ?? {}) };

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await sendOnce({
      url: currentUrl,
      method: currentMethod,
      headers: currentHeaders,
      body: currentBody,
      timeoutMs: options.timeoutMs,
      verifyTls: options.verifyTls,
      signal: options.signal,
    });

    const isRedirect = response.status >= 300 && response.status < 400 && response.headers.location;
    if (!isRedirect) {
      return response;
    }

    const location = String(response.headers.location);
    currentUrl = new URL(location, currentUrl).toString();

    // 301 / 302 / 303 按规范把方法降级为 GET 并丢弃请求体
    if (response.status === 301 || response.status === 302 || response.status === 303) {
      currentMethod = 'GET';
      currentBody = undefined;
      currentHeaders = stripEntityHeaders(currentHeaders);
    }
  }

  throw new Error(`重定向次数超过 ${MAX_REDIRECTS} 次：${options.url}`);
}

/**
 * 移除与请求实体相关的头，避免重定向降级为 GET 后携带陈旧的 Content-Length。
 * @param headers 原始请求头
 * @returns 去除实体相关头之后的请求头
 */
function stripEntityHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === 'content-length' || lower === 'content-type') {
      continue;
    }
    result[key] = value;
  }
  return result;
}

/**
 * 发送单次请求，不处理重定向。
 * @param options 请求参数
 * @returns 响应对象
 */
function sendOnce(options: HttpRequestOptions): Promise<HttpResponse> {
  return new Promise<HttpResponse>((resolve, reject) => {
    const target = new URL(options.url);
    const isHttps = target.protocol === 'https:';
    const transport = isHttps ? https : http;

    const request = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: options.method ?? 'GET',
        headers: options.headers,
        rejectUnauthorized: isHttps ? options.verifyTls !== false : undefined,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
        response.on('error', (error) => reject(new Error(`读取响应失败（${options.url}）：${error.message}`)));
      },
    );

    request.on('error', (error) => {
      reject(new Error(`请求失败（${options.url}）：${error.message}`));
    });

    const timeoutMs = options.timeoutMs ?? 20_000;
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`请求超时（${timeoutMs}ms）：${options.url}`));
    });

    if (options.signal) {
      const onAbort = () => request.destroy(new Error(`请求已取消：${options.url}`));
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
      request.on('close', () => options.signal?.removeEventListener('abort', onAbort));
    }

    if (options.body !== undefined) {
      request.write(options.body);
    }
    request.end();
  });
}
