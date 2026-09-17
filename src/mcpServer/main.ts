/**
 * 内置 MCP Server 入口（stdio 传输）。
 *
 * 由扩展通过 MCP Provider 或配置文件以子进程方式拉起。约定：
 *   - stdout 专用于 MCP 协议报文
 *   - 所有诊断信息一律写入 stderr
 *   - 配置通过环境变量注入（GITEA_SERVER_URL / GITEA_TOKEN / ...）
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createGitea } from '../core/index';
import { describeError } from '../core/errors';
import { TOOL_CATALOG, type GiteaToolContext } from '../ai/tools/index';
import { resolveDefaultRepo } from './gitRemote';

/** 从环境变量读取配置。 */
interface ServerEnv {
  serverUrl: string;
  token: string | undefined;
  verifyTls: boolean;
  timeoutMs: number;
  maxOutputLength: number;
}

/**
 * 解析环境变量配置。
 * @param env 环境变量表
 * @returns 归一化配置
 */
export function readEnv(env: NodeJS.ProcessEnv = process.env): ServerEnv {
  const timeout = Number.parseInt(env.GITEA_TIMEOUT_MS ?? '', 10);
  const maxOutput = Number.parseInt(env.GITEA_MAX_OUTPUT_LENGTH ?? '', 10);
  return {
    serverUrl: (env.GITEA_SERVER_URL ?? '').trim().replace(/\/+$/, ''),
    token: env.GITEA_TOKEN?.trim() || undefined,
    verifyTls: (env.GITEA_VERIFY_TLS ?? 'true').toLowerCase() !== 'false',
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 20_000,
    maxOutputLength: Number.isFinite(maxOutput) && maxOutput > 0 ? maxOutput : 100_000,
  };
}

/**
 * 解析扩展版本号（用于 MCP 的 serverInfo）。
 * 产物位于 dist/ 下，因此向上一级即为扩展根目录。
 * @returns 版本字符串
 */
function resolveVersion(): string {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * 向 stderr 写日志（避免污染 MCP 的 stdout 通道）。
 * @param message 消息
 * @param detail 细节
 */
function logToStderr(message: string, detail?: unknown): void {
  const suffix = detail === undefined ? '' : ` | ${detail instanceof Error ? detail.message : String(detail)}`;
  process.stderr.write(`[gitea-toolkit-mcp] ${message}${suffix}\n`);
}

/**
 * 将工具挂载到 MCP Server。
 * @param server MCP Server 实例
 * @param context 工具执行上下文
 * @param maxOutputLength 文本输出上限
 */
function registerTools(server: McpServer, context: GiteaToolContext, maxOutputLength: number): void {
  for (const tool of TOOL_CATALOG) {
    server.registerTool(
      tool.name,
      {
        title: tool.displayName,
        description: tool.description,
        inputSchema: tool.inputShape,
        annotations: {
          title: tool.displayName,
          readOnlyHint: tool.access === 'read',
          destructiveHint: tool.access === 'write',
          openWorldHint: true,
        },
      },
      async (input: Record<string, unknown>) => {
        try {
          const result = await tool.handler(input, context);
          const text = clampText(result.text, maxOutputLength);
          return {
            content: [{ type: 'text' as const, text }],
            ...(result.data !== undefined ? { structuredContent: { result: result.data } } : {}),
          };
        } catch (error) {
          logToStderr(`工具 ${tool.name} 执行失败`, error);
          return {
            content: [{ type: 'text' as const, text: `调用失败：${describeError(error)}` }],
            isError: true,
          };
        }
      },
    );
  }
}

/**
 * 截断超长文本。
 * @param text 文本
 * @param limit 上限
 * @returns 截断后的文本
 */
function clampText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}\n\n…（输出过长已截断）`;
}

/** 启动 MCP Server。 */
export async function main(): Promise<void> {
  const config = readEnv();
  if (config.serverUrl.length === 0) {
    logToStderr('缺少 GITEA_SERVER_URL 环境变量，无法启动。请通过扩展的「Gitea: 复制 MCP 配置」重新生成配置。');
    process.exit(1);
  }
  if (!config.token) {
    logToStderr('未提供 GITEA_TOKEN，工具调用将因未认证而失败。');
  }

  const { operations } = createGitea({
    serverUrl: config.serverUrl,
    token: config.token,
    verifyTls: config.verifyTls,
    timeoutMs: config.timeoutMs,
    userAgent: 'gitea-toolkit-mcp',
  });

  const context: GiteaToolContext = {
    operations,
    defaultRepo: await resolveDefaultRepo(process.cwd(), config.serverUrl),
    openExternal: async (url: string) => {
      logToStderr(`（MCP 环境无法直接打开浏览器）${url}`);
    },
  };

  const server = new McpServer(
    { name: 'gitea-toolkit', version: resolveVersion() },
    { instructions: 'Gitea 仓库 / Issue / Pull Request / 通知 的读写工具。未显式指定 owner、repo 时会尝试从当前工作目录的 git origin 远端推断。' },
  );
  registerTools(server, context, config.maxOutputLength);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logToStderr(`已启动，共 ${TOOL_CATALOG.length} 个工具；实例 ${config.serverUrl}`);
}

main().catch((error) => {
  logToStderr('启动失败', error);
  process.exit(1);
});
