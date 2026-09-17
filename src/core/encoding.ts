/**
 * 编解码工具。Gitea 的 contents 接口以 base64 传输文件内容。
 */

/**
 * 将字符串按 UTF-8 转为 base64。
 * @param text 原始文本
 * @returns base64 字符串
 */
export function encodeBase64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

/**
 * 将 base64 转为 UTF-8 字符串。
 * @param base64 base64 字符串（允许包含换行）
 * @returns 解码后的文本
 */
export function decodeBase64(base64: string): string {
  return Buffer.from(base64.replace(/\s+/g, ''), 'base64').toString('utf8');
}

/**
 * 转义 URL 路径中的每一段（保留 `/` 分隔符）。
 * @param filePath 仓库内文件路径
 * @returns 已编码的路径
 */
export function encodeRepoPath(filePath: string): string {
  return filePath
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/**
 * 粗略判断字符串是否为 base64（用于兼容不同 Gitea 版本的响应差异）。
 * @param value 待判断字符串
 * @returns 是否为 base64
 */
export function looksLikeBase64(value: string): boolean {
  const compact = value.replace(/\s+/g, '');
  return compact.length > 0 && compact.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
}
