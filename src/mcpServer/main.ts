/**
 * MCP Server 入口（stdio 传输）。
 *
 * 两种使用方式：
 *   1. VS Code 扩展内置：由扩展通过 MCP Provider 或配置文件以子进程拉起
 *   2. **独立使用**：作为 npm 包 `gitea-toolkit-mcp` 直接运行，任何 MCP 客户端均可接入
 *      （`npx -y gitea-toolkit-mcp --url ... --token ...`），无需安装扩展
 *
 * 严格约定（破坏任何一条都会让客户端无法解析协议）：
 *   - **stdout 只用于 MCP 协议报文**，任何诊断信息一律写 stderr
 *   - `--help` / `--version` 是显式的用户命令，此时才允许写 stdout 并退出
 *   - 配置来源：命令行参数优先于环境变量（GITEA_SERVER_URL / GITEA_TOKEN / ...）
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

/** 命令行用法说明。 */
const USAGE = `gitea-toolkit-mcp —— Gitea 仓库 / Issue / PR / 通知 的 MCP 工具服务（stdio）

用法：
  gitea-toolkit-mcp [选项]

选项（均可用环境变量提供，命令行参数优先）：
  --url <地址>         Gitea 实例地址              [环境变量 GITEA_SERVER_URL]
  --token <令牌>       访问令牌                    [环境变量 GITEA_TOKEN]
  --no-verify-tls      跳过 HTTPS 证书校验          [环境变量 GITEA_VERIFY_TLS=false]
  --timeout <毫秒>     请求超时，默认 20000        [环境变量 GITEA_TIMEOUT_MS]
  --max-output <字符>  单次工具输出上限，默认 100000 [环境变量 GITEA_MAX_OUTPUT_LENGTH]
  -h, --help           显示本帮助
  -v, --version        显示版本号

示例：
  npx -y gitea-toolkit-mcp --url https://gitea.example.com --token <你的令牌>

MCP 客户端配置示例（Claude Desktop / Cursor 等）：
  {
    "mcpServers": {
      "gitea": {
        "command": "npx",
        "args": ["-y", "gitea-toolkit-mcp", "--url", "https://gitea.example.com", "--token", "<令牌>"]
      }
    }
  }

令牌需在 Gitea 的「设置 → 应用 → 生成令牌」创建，勾选 repo、issue、notification 权限。`;

/** 命令行解析结果。 */
type CliAction =
  /** 正常启动，overrides 覆盖环境变量中的同名配置。 */
  | { kind: 'run'; overrides: Partial<ServerEnv> }
  | { kind: 'help' }
  | { kind: 'version' };

/**
 * 解析命令行参数。
 *
 * 只在显式要求时才产出 help / version —— 因为 stdio 模式下 stdout 归协议所有，
 * 绝不能顺手打印任何东西。
 * @param argv 原始参数（不含 node 与脚本路径）
 * @returns 解析结果
 * @throws 参数非法时抛错（由调用方打印用法后以退出码 2 结束）
 */
export function parseArgs(argv: string[]): CliAction {
  const overrides: Partial<ServerEnv> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];

    if (name === '-h' || name === '--help') {
      return { kind: 'help' };
    }
    if (name === '-v' || name === '--version') {
      return { kind: 'version' };
    }
    if (name === '--no-verify-tls') {
      overrides.verifyTls = false;
      continue;
    }

    // 其余选项均需取值，统一在此消费下一个参数
    index += 1;
    const value = argv[index];
    if (value === undefined) {
      throw new Error(`参数 ${name} 缺少取值`);
    }

    switch (name) {
      case '--url':
        overrides.serverUrl = value.trim().replace(/\/+$/, '');
        break;
      case '--token':
        overrides.token = value.trim() || undefined;
        break;
      case '--timeout':
        overrides.timeoutMs = parsePositiveInt(value, name);
        break;
      case '--max-output':
        overrides.maxOutputLength = parsePositiveInt(value, name);
        break;
      default:
        throw new Error(`未知参数：${name}`);
    }
  }

  return { kind: 'run', overrides };
}

/**
 * 解析正整数参数。
 * @param value 原始文本
 * @param name 参数名（用于报错）
 * @returns 解析结果
 */
function parsePositiveInt(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`参数 ${name} 需要一个正整数，收到「${value}」`);
  }
  return parsed;
}

/**
 * 解析扩展版本号（用于 MCP 的 serverInfo 与 `--version`）。
 *
 * 产物有两种位置，都需兼容：
 *   - `dist/mcpServer.js`（扩展内置）→ 向上一级为扩展根目录
 *   - `packages/mcp-server/dist/index.js`（独立 npm 包）→ 向上一级为包根目录
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

/**
 * 启动 MCP Server。
 * @param argv 命令行参数（默认取 process.argv 去掉 node 与脚本路径）
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  let action: CliAction;
  try {
    action = parseArgs(argv);
  } catch (error) {
    // 参数错误与「启动失败」区分开：用法写 stderr，退出码 2
    process.stderr.write(`${(error as Error).message}\n\n${USAGE}\n`);
    process.exit(2);
  }

  // help / version 是显式的用户命令，只有这两种情况才允许写 stdout
  if (action.kind === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (action.kind === 'version') {
    process.stdout.write(`${resolveVersion()}\n`);
    return;
  }

  const config: ServerEnv = { ...readEnv(), ...action.overrides };
  if (config.serverUrl.length === 0) {
    logToStderr('缺少 Gitea 实例地址，无法启动。请用 --url 指定，或设置环境变量 GITEA_SERVER_URL。');
    process.exit(1);
  }
  if (!config.token) {
    logToStderr('未提供访问令牌，工具调用将因未认证而失败。请用 --token 指定，或设置环境变量 GITEA_TOKEN。');
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
