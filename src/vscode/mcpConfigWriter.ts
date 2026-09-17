/**
 * MCP 配置文件写入工具。
 *
 * 覆盖两类目标，合并语义一致（仅覆盖 `mcpServers.gitea`，保留用户其它配置）：
 *   - **用户级**：`~/.codebuddy/mcp.json`。CodeBuddy 的 MCP 面板由该文件驱动，
 *     它**不消费** VS Code 的 `mcpServerDefinitionProviders` 贡献点，必须落盘才会被发现。
 *   - **工作区级**：`.codebuddy/mcp.json`、`.vscode/mcp.json`、`.mcp.json`。
 */
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  buildMcpConfigFile,
  buildMcpServerEntry,
  MCP_ENV,
  MCP_SERVER_NAME,
  resolveMcpServerScript,
  type McpConfigFile,
  type McpStdioServerEntry,
} from '../ai/mcpConfig';
import { logInfo, logWarn } from './logger';
import type { GiteaService } from './service';

/** 默认的 CodeBuddy 工作区级 MCP 配置路径。 */
export const CODEBUDDY_MCP_PATH = '.codebuddy/mcp.json';

/**
 * CodeBuddy 用户级 MCP 配置的候选路径（按优先级）。
 * @returns 绝对路径数组
 */
export function codeBuddyUserConfigPaths(): string[] {
  const home = os.homedir();
  return [path.join(home, '.codebuddy', 'mcp.json'), path.join(home, '.codebuddycn', 'mcp.json')];
}

/**
 * 构造当前配置下的 MCP 配置文件内容。
 * @param context 扩展上下文
 * @param service Gitea 服务
 * @param tokenOverride 令牌覆盖（用于在改写配置时保留原有令牌）
 * @returns MCP 配置对象
 */
export async function buildCurrentMcpConfig(
  context: vscode.ExtensionContext,
  service: GiteaService,
  tokenOverride?: string,
): Promise<McpConfigFile> {
  const token = tokenOverride ?? (await service.getToken());
  const entry = buildMcpServerEntry({
    scriptPath: resolveMcpServerScript(context),
    token,
  });
  return buildMcpConfigFile(entry);
}

/**
 * 把 MCP 配置写入工作区内的指定文件，并与已有内容合并。
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
  const merged = await mergeExistingConfig(targetUri.fsPath, config);
  await fs.mkdir(path.dirname(targetUri.fsPath), { recursive: true });
  await fs.writeFile(targetUri.fsPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  logInfo(`已写入 MCP 配置：${targetUri.fsPath}`);
  return targetUri;
}

/**
 * 写入 CodeBuddy 用户级 MCP 配置。
 *
 * 优先写已存在的候选文件（说明该客户端正在用它），都不存在时写 `~/.codebuddy/mcp.json`。
 * @param context 扩展上下文
 * @param service Gitea 服务
 * @returns 实际写入的绝对路径
 */
export async function writeCodeBuddyUserMcpConfig(
  context: vscode.ExtensionContext,
  service: GiteaService,
  tokenOverride?: string,
): Promise<string> {
  const filePath = pickUserConfigPath();
  const config = await buildCurrentMcpConfig(context, service, tokenOverride);
  const merged = await mergeExistingConfig(filePath, config);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  logInfo(`已写入 CodeBuddy 用户级 MCP 配置：${filePath}`);
  return filePath;
}

/**
 * 修复用户级配置里指向本扩展 MCP 脚本的过期路径。
 *
 * 扩展安装目录名含版本号（`<publisher>.<name>-<version>`），升级后旧路径即失效，
 * 表现为 CodeBuddy 里该 Server 始终启动失败。此处在激活时静默纠正。
 *
 * 只在「该文件已存在、且其中确实有我们的条目、且路径指向 gitea-toolkit 产物」时才改写，
 * 因此不会凭空创建配置，也不会动别人的条目。
 * @param context 扩展上下文
 * @param service Gitea 服务
 * @returns 是否发生了修复
 */
export async function repairCodeBuddyUserMcpConfig(
  context: vscode.ExtensionContext,
  service: GiteaService,
): Promise<boolean> {
  const expected = resolveMcpServerScript(context);

  for (const filePath of codeBuddyUserConfigPaths()) {
    if (!fsSync.existsSync(filePath)) {
      continue;
    }
    let entry: McpStdioServerEntry | undefined;
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as Partial<McpConfigFile>;
      entry = parsed.mcpServers?.[MCP_SERVER_NAME];
    } catch {
      continue;
    }
    if (!entry) {
      continue;
    }
    const current = Array.isArray(entry.args) ? entry.args[0] : undefined;
    if (current === expected) {
      return false;
    }
    if (typeof current !== 'string' || !current.includes('gitea-toolkit')) {
      // 该条目不是本扩展写的（或结构被手工改过），不擅自覆盖
      logWarn(`跳过 MCP 配置修复：${filePath} 中 gitea 条目的脚本路径与预期不符`);
      continue;
    }
    try {
      await writeCodeBuddyUserMcpConfig(context, service, entry.env?.[MCP_ENV.token]);
      logInfo(`已更新 MCP 配置中的脚本路径：${current} → ${expected}`);
      return true;
    } catch (error) {
      logWarn('更新 MCP 配置中的脚本路径失败', error);
      return false;
    }
  }
  return false;
}

/**
 * 工作区级目标文件是否已存在。
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
 * 激活时自动写入 CodeBuddy 工作区级 MCP 配置（仅当文件不存在且已设置令牌）。
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
 * 选出实际要写入的用户级配置文件。
 * @returns 绝对路径
 */
function pickUserConfigPath(): string {
  const candidates = codeBuddyUserConfigPaths();
  return candidates.find((filePath) => fsSync.existsSync(filePath)) ?? candidates[0];
}

/**
 * 读取已有配置文件并合并 MCP Server 条目，避免覆盖用户的其他配置。
 * @param filePath 目标文件绝对路径
 * @param incoming 待写入的配置
 * @returns 合并后的配置
 */
async function mergeExistingConfig(filePath: string, incoming: McpConfigFile): Promise<McpConfigFile> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
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
      throw new Error(`现有配置 ${filePath} 不是合法 JSON，已中止以免覆盖`);
    }
    throw error;
  }
}
