/**
 * MCP Server 定义提供者。
 *
 * 通过 `vscode.lm.registerMcpServerDefinitionProvider` 把内置 MCP Server 动态注册给编辑器，
 * CodeBuddy / VS Code 等基于 VS Code 内核的 AI IDE 会自动发现并加载其中的 Gitea 工具，
 * 用户无需手工编辑 mcp.json。
 *
 * 说明：
 *   - `provideMcpServerDefinitions` 会被编辑器「急切」调用，因此这里不做任何用户交互
 *   - 访问令牌在 `resolveMcpServerDefinition`（即将启动服务器时）才注入，避免密钥长期驻留在配置对象里
 *   - 老版本编辑器若缺少该 API，则静默跳过，由「复制 / 写入 MCP 配置」命令兜底
 */
import * as vscode from 'vscode';
import { MCP_ENV, resolveMcpServerScript, resolveNodeLaunch } from './mcpConfig';
import { readSettings } from '../vscode/config';
import { logInfo, logWarn } from '../vscode/logger';
import type { GiteaService } from '../vscode/service';

/** MCP Provider ID，必须与 package.json 中 `contributes.mcpServerDefinitionProviders[].id` 一致。 */
export const MCP_PROVIDER_ID = 'giteaToolkit.mcp';

/** MCP Server 在编辑器 UI 中显示的名称。 */
export const MCP_SERVER_LABEL = 'Gitea Toolkit';

/**
 * 注册 MCP Server 定义提供者。
 * @param context 扩展上下文
 * @param service Gitea 服务
 */
export function registerMcpServerProvider(context: vscode.ExtensionContext, service: GiteaService): void {
  const registrar = (
    vscode.lm as typeof vscode.lm & {
      registerMcpServerDefinitionProvider?: (
        id: string,
        provider: {
          onDidChangeMcpServerDefinitions?: vscode.Event<void>;
          provideMcpServerDefinitions: (token: vscode.CancellationToken) => vscode.ProviderResult<vscode.McpServerDefinition[]>;
          resolveMcpServerDefinition?: (
            server: vscode.McpServerDefinition,
            token: vscode.CancellationToken,
          ) => vscode.ProviderResult<vscode.McpServerDefinition>;
        },
      ) => vscode.Disposable;
    }
  ).registerMcpServerDefinitionProvider;

  if (typeof registrar !== 'function' || typeof vscode.McpStdioServerDefinition !== 'function') {
    // CodeBuddy 属于这一类：它的 MCP 面板由用户级 ~/.codebuddy/mcp.json 驱动，
    // 不消费本贡献点，必须落盘才能被发现。
    logWarn(
      '当前编辑器不支持 MCP Server Definition Provider（CodeBuddy 即属此类）。' +
        '请执行「Gitea: 写入 CodeBuddy MCP 配置」完成接入，或用「Gitea: 复制 MCP 配置」手工粘贴。',
    );
    return;
  }

  const changeEmitter = new vscode.EventEmitter<void>();

  const disposable = registrar.call(vscode.lm, MCP_PROVIDER_ID, {
    onDidChangeMcpServerDefinitions: changeEmitter.event,

    provideMcpServerDefinitions: (): vscode.McpServerDefinition[] => {
      const settings = readSettings();
      if (!settings.enableMcpServer) {
        return [];
      }
      if (settings.serverUrl.length === 0) {
        logWarn('未配置 gitea.serverUrl，暂不提供 MCP Server');
        return [];
      }
      const launch = resolveNodeLaunch();
      const definition = new vscode.McpStdioServerDefinition(
        MCP_SERVER_LABEL,
        launch.command,
        [resolveMcpServerScript(context)],
        {
          ...launch.env,
          [MCP_ENV.serverUrl]: settings.serverUrl,
          [MCP_ENV.verifyTls]: settings.verifyTls ? 'true' : 'false',
          [MCP_ENV.timeoutMs]: String(settings.requestTimeoutMs),
        },
        context.extension.packageJSON.version as string,
      );
      definition.cwd = vscode.workspace.workspaceFolders?.[0]?.uri;
      return [definition];
    },

    resolveMcpServerDefinition: async (server: vscode.McpServerDefinition) => {
      const token = await service.getToken();
      if (!token) {
        throw new Error(
          'Gitea 访问令牌尚未设置。请先执行「Gitea: 设置访问令牌」，再重新发起对话。',
        );
      }
      if (server instanceof vscode.McpStdioServerDefinition) {
        server.env[MCP_ENV.token] = token;
      }
      return server;
    },
  });

  context.subscriptions.push(
    disposable,
    changeEmitter,
    service.onDidChange(() => changeEmitter.fire()),
  );
  logInfo('已注册 MCP Server 定义提供者，编辑器将自动发现 Gitea 工具');
}
