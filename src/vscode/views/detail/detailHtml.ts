/**
 * 详情面板的 HTML 骨架与内容安全策略。
 *
 * Webview 内联样式与脚本（避免额外的资源加载与构建配置），因此必须通过 nonce 授权脚本，
 * 并把图片源限制在扩展自身资源与目标 Gitea 实例上。
 */
import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { DETAIL_SCRIPT } from './detailScript';
import { DETAIL_STYLES } from './detailStyles';

/**
 * 构造详情面板的完整 HTML。
 * @param webview Webview 实例（用于取 `cspSource`）
 * @param serverUrl Gitea 实例地址（用于放行头像与附件图片）
 * @returns HTML 文档字符串
 */
export function buildDetailHtml(webview: vscode.Webview, serverUrl: string): string {
  const nonce = randomBytes(16).toString('base64');
  const origin = resolveOrigin(serverUrl);
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data: ${origin} https:`,
    `font-src ${webview.cspSource} ${origin}`,
    "style-src 'unsafe-inline'",
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Gitea</title>
<style>${DETAIL_STYLES}</style>
</head>
<body>
<header class="header" id="header"></header>

<section class="section">
  <div class="md" id="body-content"></div>
</section>

<section class="section hidden" id="files-section">
  <div class="section-title">变更文件</div>
  <table class="files"><tbody id="files-table"></tbody></table>
</section>

<section class="section hidden" id="reviews-section">
  <div class="section-title">评审记录</div>
  <div id="reviews-list"></div>
</section>

<section class="section">
  <div class="section-title">评论（<span id="comments-count">0</span>）</div>
  <div id="comments-list"></div>
</section>

<div class="composer">
  <textarea id="composer-input" placeholder="写下回复…（支持 Markdown，Ctrl/Cmd + Enter 发表）"></textarea>
  <div class="composer-bar" id="composer-bar"></div>
  <div class="composer-bar" id="action-bar"></div>
</div>

<script nonce="${nonce}">${DETAIL_SCRIPT}</script>
</body>
</html>`;
}

/**
 * 从实例地址中提取 origin，用于 CSP 白名单。
 * @param serverUrl 实例地址
 * @returns origin；解析失败时返回空串
 */
function resolveOrigin(serverUrl: string): string {
  try {
    return new URL(serverUrl).origin;
  } catch {
    return '';
  }
}
