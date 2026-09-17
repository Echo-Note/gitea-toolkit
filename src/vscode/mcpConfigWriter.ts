/**
 * MCP 配置文件写入工具。
 *
 * 供「Gitea: 写入 MCP 配置文件」命令与激活时的自动写入（CodeBuddy 场景）共用，
 * 保证两处的合并语义一致：仅覆盖 `mcpServers.gitea`，保留用户其它配置。
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  buildMcpConfigFile,
  buildMcpServerEntry,
  resolveMcpServerScript,
  type McpConfigFile,
} from '../ai/mcpConfig';
import { logInfo, logWarn } from './logger';
import type { GiteaService } from './service';

/**
 * 构造当前配置下的 MCP 配置文件内容（含访问令牌）。
 * @param context 扩展上下文
 * @param service Gitea 服务
 * @returns MCP 配置对象
 */
export async function buildCurrentMcpConfig(
  context: vscode.ExtensionContext,
  service: GiteaService,
): Promise<McpConfigFile> {
  const token = await service.getToken();
  const entry = buildMcpServerEntry({
    scriptPath: resolveMcpServerScript(context),
    token,
  });
  return buildMcpConfigFile(entry);
}

/**
 * 把 MCP 配置写入指定文件，并与已有内容合并。
 * @param root 工作区根目录
 * @param relativePath 相对路径
 * @param config 待写入配置
 * @returns 写入后的文件 URI
 */
export async function writeMcpConfig(
  root: vscode.Uri,
  relativePath: string,
  config: McpConfigFile,
): Promise<vscode.Uri> {
  const targetUri = vscode.Uri.joinPath(root, relativePath);
  const merged = await mergeExistingConfig(targetUri, config);
  await fs.mkdir(path.dirname(targetUri.fsPath), { recursive: true });
  await fs.writeFile(targetUri.fsPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  logInfo(`已写入 MCP 配置：${targetUri.fsPath}`);
  return targetUri;
}

/**
 * 目标文件是否已存在。
 * @param root 工作区根目录
 * @param relativePath 相对路径
 * @returns 是否存在
 */
export async function mcpConfigExists(root: vscode.Uri, relativePath: string): Promise<boolean> {
  try {
    await fs.access(vscode.Uri.joinPath(root, relativePath).fsPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 激活时自动写入 CodeBuddy 项目级 MCP 配置（仅当文件不存在且已设置令牌）。
 * @param context 扩展上下文
 * @param service Gitea 服务
 * @param relativePath 目标相对路径
 */
export async function autoWriteCodeBuddyConfig(
  context: vscode.ExtensionContext,
  service: GiteaService,
  relativePath: string = CODEBUDDY_MCP_PATH,
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return;
  }
  const root = folders[0].uri;
  try {
    if (await mcpConfigExists(root, relativePath)) {
      return;
    }
    if (!(await service.getToken())) {
      logWarn('未设置访问令牌，跳过自动写入 CodeBuddy MCP 配置');
      return;
    }
    const config = await buildCurrentMcpConfig(context, service);
    await writeMcpConfig(root, relativePath, config);
  } catch (error) {
    logWarn('自动写入 CodeBuddy MCP 配置失败，可改用「Gitea: 写入 MCP 配置文件」命令', error);
  }
}

/**
 * 读取已有配置文件并合并 MCP Server 条目，避免覆盖用户的其他配置。
 * @param uri 目标文件
 * @param incoming 待写入的配置
 * @returns 合并后的配置
 */
async function mergeExistingConfig(uri: vscode.Uri, incoming: McpConfigFile): Promise<McpConfigFile> {
  try {
    const raw = await fs.readFile(uri.fsPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<McpConfigFile> & Record<string, unknown>;
    return {
      ...parsed,
      mcpServers: {
        ...(parsed.mcpServers ?? {}),
        ...incoming.mcpServers,
      },
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return incoming;
    }
    if (error instanceof SyntaxError) {
      throw new Error(`现有配置 ${uri.fsPath} 不是合法 JSON，已中止以免覆盖`);
    }
    throw error;
  }
}

/** 默认的 CodeBuddy MCP 配置路径。 */
export const CODEBUDDY_MCP_PATH = '.codebuddy/mcp.json';
