/**
 * 扩展激活入口。
 *
 * 激活流程：
 *   1. 构造 Gitea 服务（配置 + 令牌 + 缓存）
 *   2. 注册侧边栏四个树视图
 *   3. 注册命令
 *   4. 面向 AI 的两条接入路径：语言模型工具（常驻）与内置 MCP Server（子进程）
 *   5. 状态栏与「令牌 / 配置变化 → 视图自动刷新」联动
 */
import * as vscode from 'vscode';
import { registerLanguageModelTools } from './ai/lmTools';
import { registerMcpServerProvider } from './ai/mcpProvider';
import { readSettings } from './vscode/config';
import { createCommands, registerCommands } from './vscode/commands/index';
import { verifyCompatibility } from './vscode/compatibility';
import { logDebug, logError, logInfo, logWarn, disposeLog } from './vscode/logger';
import { autoWriteCodeBuddyConfig, repairCodeBuddyUserMcpConfig } from './vscode/mcpConfigWriter';
import { GiteaService } from './vscode/service';
import { StatusBarController } from './vscode/statusBar';
import { IssuesProvider } from './vscode/views/issuesProvider';
import { NotificationsProvider } from './vscode/views/notificationsProvider';
import { PullsProvider } from './vscode/views/pullsProvider';
import { ReposProvider } from './vscode/views/reposProvider';

/**
 * 激活扩展。
 * @param context 扩展上下文
 */
export function activate(context: vscode.ExtensionContext): void {
  logInfo('Gitea Toolkit 正在激活');

  const service = new GiteaService(context);
  const providers = {
    repos: new ReposProvider(service),
    issues: new IssuesProvider(service),
    pulls: new PullsProvider(service),
    notifications: new NotificationsProvider(service),
  };

  context.subscriptions.push(
    service,
    providers.repos,
    providers.issues,
    providers.pulls,
    providers.notifications,
  );

  registerViews(context, providers);
  registerCommands(context, createCommands({ context, service, providers }));
  registerAiIntegrations(context, service);
  registerStatusBar(context, service);
  registerAutoRefresh(context, service, providers);

  if (readSettings().writeCodeBuddyConfigOnActivate) {
    void autoWriteCodeBuddyConfig(context, service);
  }

  // 扩展安装目录含版本号，升级后用户级 MCP 配置里的脚本路径会失效（表现为 CodeBuddy 里启动失败）。
  // 这里静默纠正：仅在「该配置已存在且确实有我们的条目」时才改写，不会凭空创建。
  void repairCodeBuddyUserMcpConfig(context, service).catch((error) => {
    logWarn('修复 CodeBuddy 用户级 MCP 配置失败', error);
  });

  // 后台核对服务端版本：仅在版本与上次告警的不同时弹窗，因此不会反复打扰
  void checkCompatibilityOnActivate(context, service);

  // 不再内置「检查扩展自身更新」：扩展已同时上架 Open VSX 与 VS Code Marketplace，
  // 两个渠道都由编辑器自动更新。内置一套比对 GitHub Releases 的检查只会产生
  // 第二个「最新版本」口径，与市场不同步时反而误导用户。
  logInfo('Gitea Toolkit 激活完成');
}

/**
 * 激活时后台核对 Gitea 版本兼容性。
 *
 * 之所以放在激活阶段而不只是登录阶段：令牌长期有效，但服务端可能被升级，
 * 此时同样需要提醒用户「扩展已核对的版本与当前服务端不一致」。
 * 未配置实例或令牌时静默跳过。
 * @param context 扩展上下文
 * @param service Gitea 服务
 */
async function checkCompatibilityOnActivate(
  context: vscode.ExtensionContext,
  service: GiteaService,
): Promise<void> {
  try {
    if (!(await service.isReady())) {
      return;
    }
    await verifyCompatibility(context, service);
  } catch (error) {
    logWarn('激活时的版本兼容性检查失败', error);
  }
}

/**
 * 释放扩展资源。
 */
export function deactivate(): void {
  disposeLog();
}

/**
 * 注册四个侧边栏树视图。
 * @param context 扩展上下文
 * @param providers 视图提供者集合
 */
function registerViews(
  context: vscode.ExtensionContext,
  providers: {
    repos: ReposProvider;
    issues: IssuesProvider;
    pulls: PullsProvider;
    notifications: NotificationsProvider;
  },
): void {
  const registrations = [
    ['gitea.repos', providers.repos],
    ['gitea.issues', providers.issues],
    ['gitea.pulls', providers.pulls],
    ['gitea.notifications', providers.notifications],
  ] as const;

  for (const [viewId, provider] of registrations) {
    context.subscriptions.push(vscode.window.registerTreeDataProvider(viewId, provider));
  }
}

/**
 * 注册面向 AI 助手的两条接入路径。
 * @param context 扩展上下文
 * @param service Gitea 服务
 */
function registerAiIntegrations(context: vscode.ExtensionContext, service: GiteaService): void {
  const settings = readSettings();
  if (settings.enableLanguageModelTools) {
    try {
      registerLanguageModelTools(context, service);
    } catch (error) {
      logError('注册语言模型工具失败', error);
    }
  }
  if (settings.enableMcpServer) {
    try {
      registerMcpServerProvider(context, service);
    } catch (error) {
      logError('注册 MCP Server 提供者失败', error);
    }
  }
}

/**
 * 注册状态栏。
 * @param context 扩展上下文
 * @param service Gitea 服务
 */
function registerStatusBar(context: vscode.ExtensionContext, service: GiteaService): void {
  const statusBar = new StatusBarController(service);
  statusBar.registerCommands(context);
  context.subscriptions.push(statusBar);
  void statusBar.refresh();
}

/**
 * 令牌 / 配置变化时自动刷新所有视图。
 * @param context 扩展上下文
 * @param service Gitea 服务
 * @param providers 视图提供者集合
 */
function registerAutoRefresh(
  context: vscode.ExtensionContext,
  service: GiteaService,
  providers: {
    repos: ReposProvider;
    issues: IssuesProvider;
    pulls: PullsProvider;
    notifications: NotificationsProvider;
  },
): void {
  context.subscriptions.push(
    service.onDidChange(() => {
      // 统一刷新入口：手动「Gitea: 刷新所有视图」也走这里（见 authCommands 的 gitea.refresh）。
      // 两条路径共用同一段代码，才不会出现「手动有效、自动无效」这类行为分叉。
      logDebug(`令牌 / 配置变化，刷新 ${Object.keys(providers).length} 个视图`);
      for (const provider of Object.values(providers)) {
        provider.refresh();
      }
    }),
  );
}
