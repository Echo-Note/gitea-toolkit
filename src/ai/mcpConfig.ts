/**
 * 内置 MCP Server 的启动参数与配置生成。
 *
 * 该模块同时服务于三条接入路径：
 *   1. VS Code / CodeBuddy 的 MCP Provider 动态注册（推荐，无需落盘）
 *   2. 生成 `.codebuddy/mcp.json`、`.vscode/mcp.json` 等配置文件
 *   3. 复制配置片段到剪贴板，供其他 MCP 客户端粘贴
 */
import * as path from 'node:path';
import type * as vscode from 'vscode';
import { readSettings } from '../vscode/config';

/** stdio 型 MCP Server 配置项。 */
export interface McpStdioServerEntry {
  type: 'stdio';
  command: string;
  args: string[];
  env?: Record<string, string>;
  description?: string;
}

/** MCP 配置文件结构。 */
export interface McpConfigFile {
  mcpServers: Record<string, McpStdioServerEntry>;
}

/** 默认的 MCP Server 名称。 */
export const MCP_SERVER_NAME = 'gitea';

/** MCP Server 传入的环境变量名。 */
export const MCP_ENV = {
  serverUrl: 'GITEA_SERVER_URL',
  token: 'GITEA_TOKEN',
  verifyTls: 'GITEA_VERIFY_TLS',
  timeoutMs: 'GITEA_TIMEOUT_MS',
  maxOutputLength: 'GITEA_MAX_OUTPUT_LENGTH',
} as const;

/** 启动命令与附加环境变量。 */
export interface NodeLaunch {
  /** 可执行文件路径。 */
  command: string;
  /** 需要注入的环境变量。 */
  env: Record<string, string>;
}

/**
 * 解析可用的 Node 运行时。
 *
 * Electron 系宿主（VS Code / CodeBuddy 桌面版）的 `process.execPath` 指向编辑器本体，
 * 需配合 `ELECTRON_RUN_AS_NODE=1` 才能以纯 Node 模式启动脚本；其余场景回退到 PATH 中的 node。
 * @returns 启动命令与环境变量
 */
export function resolveNodeLaunch(): NodeLaunch {
  const isElectron = typeof process.versions.electron === 'string' && process.versions.electron.length > 0;
  if (isElectron && process.execPath) {
    return { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
  }
  return { command: 'node', env: {} };
}

/**
 * 解析 MCP Server 脚本的绝对路径。
 * @param context 扩展上下文
 * @returns dist/mcpServer.js 的绝对路径
 */
export function resolveMcpServerScript(context: vscode.ExtensionContext): string {
  return path.join(context.extensionUri.fsPath, 'dist', 'mcpServer.js');
}

/**
 * 构造 stdio MCP Server 配置项。
 * @param options 参数
 * @returns MCP Server 配置项
 */
export function buildMcpServerEntry(options: {
  /** mcpServer.js 绝对路径。 */
  scriptPath: string;
  /** 可选的实例地址覆盖。 */
  serverUrl?: string;
  /** 可选的访问令牌。 */
  token?: string;
}): McpStdioServerEntry {
  const settings = readSettings();
  const launch = resolveNodeLaunch();
  const env: Record<string, string> = {
    ...launch.env,
    [MCP_ENV.serverUrl]: options.serverUrl ?? settings.serverUrl,
    [MCP_ENV.verifyTls]: settings.verifyTls ? 'true' : 'false',
    [MCP_ENV.timeoutMs]: String(settings.requestTimeoutMs),
  };
  if (options.token) {
    env[MCP_ENV.token] = options.token;
  }
  return {
    type: 'stdio',
    command: launch.command,
    args: [options.scriptPath],
    env,
    description: 'Gitea Toolkit：仓库 / Issue / PR / 通知 / 工作流 读写工具',
  };
}

/**
 * 构造完整的 MCP 配置文件内容。
 * @param entry MCP Server 配置项
 * @param name Server 名称
 * @returns 配置文件对象
 */
export function buildMcpConfigFile(entry: McpStdioServerEntry, name = MCP_SERVER_NAME): McpConfigFile {
  return { mcpServers: { [name]: entry } };
}

/**
 * 生成写入工作区时使用的配置文件名清单（按优先级）。
 * @returns 相对路径数组
 */
export function candidateConfigPaths(): string[] {
  return ['.codebuddy/mcp.json', '.vscode/mcp.json', '.mcp.json'];
}
