/**
 * 扩展配置与凭据管理。
 *
 * 访问令牌存放在 `vscode.SecretStorage`（系统钥匙串），绝不写入 settings.json，
 * 避免令牌随工作区配置被提交到代码仓库。
 */
import * as vscode from 'vscode';
import type { GiteaClientOptions } from '../core/giteaClient';

/** 配置节前缀。 */
const CONFIG_SECTION = 'gitea';

/** SecretStorage 中保存令牌的键。 */
export const TOKEN_SECRET_KEY = 'gitea-toolkit.accessToken';

/** 用户可配置项。 */
export interface GiteaSettings {
  /** 实例地址。 */
  serverUrl: string;
  /** 新建仓库 / Issue 时的默认所属者。 */
  defaultOwner: string;
  /** 是否校验 TLS 证书。 */
  verifyTls: boolean;
  /** 请求超时（毫秒）。 */
  requestTimeoutMs: number;
  /** 列表分页大小。 */
  pageSize: number;
  /** 是否启用内置 MCP Server。 */
  enableMcpServer: boolean;
  /** 是否向 AI Agent 注册语言模型工具。 */
  enableLanguageModelTools: boolean;
  /** 激活时是否自动写入 .codebuddy/mcp.json。 */
  writeCodeBuddyConfigOnActivate: boolean;
  /** 是否每天自动检查扩展自身的新版本。 */
  checkUpdates: boolean;
}

/**
 * 读取扩展配置。
 * @returns 归一化后的配置对象
 */
export function readSettings(): GiteaSettings {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const verifyTls = config.get<boolean>('verifyTls', true);
  const legacyIgnore = config.get<boolean>('ignoreCertificates', false);
  return {
    serverUrl: (config.get<string>('serverUrl', '') ?? '').trim().replace(/\/+$/, ''),
    defaultOwner: (config.get<string>('defaultOwner', '') ?? '').trim(),
    // 兼容旧配置项 gitea.ignoreCertificates
    verifyTls: legacyIgnore ? false : verifyTls,
    requestTimeoutMs: clampNumber(config.get<number>('requestTimeoutMs', 20_000), 1_000, 300_000),
    pageSize: clampNumber(config.get<number>('pageSize', 50), 1, 200),
    enableMcpServer: config.get<boolean>('enableMcpServer', true),
    enableLanguageModelTools: config.get<boolean>('enableLanguageModelTools', true),
    writeCodeBuddyConfigOnActivate: config.get<boolean>('writeCodeBuddyConfigOnActivate', false),
    checkUpdates: config.get<boolean>('checkUpdates', true),
  };
}

/**
 * 构造 HTTP 客户端参数。
 * @param token 访问令牌
 * @param userAgent User-Agent 标识（由调用方从扩展上下文中取版本号，避免硬编码扩展 ID）
 * @returns 客户端参数
 */
export function buildClientOptions(token: string | undefined, userAgent: string): GiteaClientOptions {
  const settings = readSettings();
  return {
    serverUrl: settings.serverUrl,
    token,
    verifyTls: settings.verifyTls,
    timeoutMs: settings.requestTimeoutMs,
    userAgent,
  };
}

/**
 * 由扩展上下文构造 User-Agent。
 * @param context 扩展上下文
 * @returns 形如 `gitea-toolkit-vscode/0.1.0` 的标识
 */
export function buildUserAgent(context: vscode.ExtensionContext): string {
  const version = (context.extension.packageJSON as { version?: string }).version ?? '0.0.0';
  return `${context.extension.id}/${version}`;
}

/**
 * 读取访问令牌。
 * @param context 扩展上下文
 * @returns 访问令牌；未设置时返回 undefined
 */
export function getToken(context: vscode.ExtensionContext): Thenable<string | undefined> {
  return context.secrets.get(TOKEN_SECRET_KEY);
}

/**
 * 保存访问令牌。
 * @param context 扩展上下文
 * @param token 访问令牌
 */
export function setToken(context: vscode.ExtensionContext, token: string): Thenable<void> {
  return context.secrets.store(TOKEN_SECRET_KEY, token);
}

/**
 * 删除访问令牌。
 * @param context 扩展上下文
 */
export function clearToken(context: vscode.ExtensionContext): Thenable<void> {
  return context.secrets.delete(TOKEN_SECRET_KEY);
}

/**
 * 监听配置变化。
 * @param listener 回调
 * @returns 可释放对象
 */
export function onSettingsChanged(listener: () => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(CONFIG_SECTION)) {
      listener();
    }
  });
}

/**
 * 数值区间裁剪。
 * @param value 原始值
 * @param min 最小值
 * @param max 最大值
 * @returns 裁剪后的值
 */
function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}
