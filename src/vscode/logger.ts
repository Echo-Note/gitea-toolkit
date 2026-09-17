/**
 * 输出通道日志封装。所有面向用户的诊断信息统一走这里，便于用户在「Gitea: 显示日志」中排查。
 */
import * as vscode from 'vscode';

/** 日志级别。 */
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

/** 全局唯一的输出通道。 */
let channel: vscode.OutputChannel | undefined;

/**
 * 获取（懒创建）输出通道。
 * @returns 输出通道
 */
function getChannel(): vscode.OutputChannel {
  channel ??= vscode.window.createOutputChannel('Gitea Toolkit');
  return channel;
}

/**
 * 写入一条日志。
 * @param level 级别
 * @param message 消息
 * @param detail 附加细节（错误对象等）
 */
export function log(level: LogLevel, message: string, detail?: unknown): void {
  const timestamp = new Date().toISOString();
  const suffix = detail === undefined ? '' : ` | ${formatDetail(detail)}`;
  getChannel().appendLine(`[${timestamp}] [${level.toUpperCase()}] ${message}${suffix}`);
}

/** 记录信息日志。 */
export const logInfo = (message: string, detail?: unknown): void => log('info', message, detail);
/** 记录警告日志。 */
export const logWarn = (message: string, detail?: unknown): void => log('warn', message, detail);
/** 记录错误日志。 */
export const logError = (message: string, detail?: unknown): void => log('error', message, detail);
/** 记录调试日志。 */
export const logDebug = (message: string, detail?: unknown): void => log('debug', message, detail);

/**
 * 显示输出通道。
 */
export function showLog(): void {
  getChannel().show(true);
}

/**
 * 释放输出通道。
 */
export function disposeLog(): void {
  channel?.dispose();
  channel = undefined;
}

/**
 * 格式化日志细节，并隐去可能的敏感信息（访问令牌）。
 * @param detail 细节对象
 * @returns 字符串
 */
function formatDetail(detail: unknown): string {
  if (detail instanceof Error) {
    return `${detail.name}: ${detail.message}`;
  }
  if (typeof detail === 'string') {
    return redact(detail);
  }
  try {
    return redact(JSON.stringify(detail));
  } catch {
    return String(detail);
  }
}

/**
 * 脱敏：替换形如 `token xxx` / `Authorization: token xxx` 的内容。
 * @param text 原始文本
 * @returns 脱敏后的文本
 */
function redact(text: string): string {
  return text.replace(/(token\s+)[A-Za-z0-9_-]{6,}/gi, '$1***');
}
