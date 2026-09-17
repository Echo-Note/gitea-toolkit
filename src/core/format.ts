/**
 * 通用格式化工具（不依赖 VS Code，扩展 UI 与 AI 工具共用）。
 */

/** 单条文本块的最大字符数，超出即截断。 */
export const MAX_TEXT_LENGTH = 60_000;

/**
 * 截断过长文本。
 * @param text 原始文本
 * @param max 最大长度
 * @returns 截断后的文本
 */
export function truncate(text: string, max = MAX_TEXT_LENGTH): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n\n…（内容过长，已截断，共 ${text.length} 字符）`;
}

/**
 * 将时间字符串转换为相对时间描述。
 * @param iso ISO 时间字符串
 * @returns 相对时间；无法解析时返回原值
 */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) {
    return '-';
  }
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) {
    return iso;
  }
  const diffSeconds = Math.round((Date.now() - timestamp) / 1000);
  const units: Array<[number, string]> = [
    [60, '秒'],
    [60, '分钟'],
    [24, '小时'],
    [30, '天'],
    [12, '个月'],
  ];
  let value = Math.abs(diffSeconds);
  let unit = '秒';
  for (const [factor, name] of units) {
    unit = name;
    if (value < factor) {
      break;
    }
    value = Math.round(value / factor);
  }
  const suffix = diffSeconds >= 0 ? '前' : '后';
  return `${value} ${unit}${suffix}`;
}

/**
 * 转义 HTML 特殊字符。
 * @param text 原始文本
 * @returns 可安全嵌入 HTML 的文本
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 把 HTML 片段中以 `/` 开头的相对 URL 补全为实例绝对地址。
 *
 * 服务端渲染出的 Markdown 会保留 `/attachments/...`、`/user/repo/...` 这类相对路径，
 * 在 Webview 中必须补全 host 才能定位到实例。
 * @param html HTML 片段
 * @param serverUrl 实例地址
 * @returns 补全后的 HTML
 */
export function absolutizeHtmlUrls(html: string, serverUrl: string): string {
  const base = serverUrl.replace(/\/+$/, '');
  return html
    .replace(/(\s(?:src|href))="\/(?!\/)/g, `$1="${base}/`)
    .replace(/(\ssrcset)="\/(?!\/)/g, `$1="${base}/`);
}

/**
 * 把单个 URL 补全为绝对地址。
 * @param url 原始 URL
 * @param serverUrl 实例地址
 * @returns 绝对地址；无法判断时原样返回
 */
export function absolutizeUrl(url: string | undefined, serverUrl: string): string {
  if (!url) {
    return '';
  }
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('data:')) {
    return url;
  }
  return `${serverUrl.replace(/\/+$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
}
