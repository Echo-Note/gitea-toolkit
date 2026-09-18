/**
 * 状态栏条目：展示 Gitea 连接状态，点击可快速切换账号 / 刷新。
 */
import * as vscode from 'vscode';
import { readSettings } from './config';
import { logDebug } from './logger';
import type { GiteaService } from './service';

/** 状态栏控制器。 */
export class StatusBarController implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];

  /**
   * @param service Gitea 服务
   */
  constructor(private readonly service: GiteaService) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.item.command = 'gitea.showStatusMenu';
    this.disposables.push(this.service.onDidChange(() => void this.refresh()));
    this.disposables.push(vscode.window.onDidChangeWindowState(() => void this.refresh()));
  }

  /**
   * 注册状态栏相关命令。
   * @param context 扩展上下文
   */
  public registerCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand('gitea.showStatusMenu', () => this.showMenu()),
    );
  }

  /** 刷新状态栏显示。 */
  public async refresh(): Promise<void> {
    const settings = readSettings();
    if (settings.serverUrl.length === 0) {
      this.item.text = '$(plug) Gitea: 未配置';
      this.item.tooltip = '点击设置 Gitea 实例地址与访问令牌';
      this.item.show();
      return;
    }
    const token = await this.service.getToken();
    if (!token) {
      this.item.text = '$(key) Gitea: 未登录';
      this.item.tooltip = `点击设置 ${settings.serverUrl} 的访问令牌`;
      this.item.show();
      return;
    }
    try {
      const user = await this.service.getCurrentUser();
      // 版本取缓存，避免状态栏刷新时反复请求 /version
      const info = await this.service.getGiteaVersion().catch(() => undefined);
      this.item.text = `$(account) ${user.login}`;
      this.item.tooltip = [
        `已连接 ${settings.serverUrl}`,
        `服务端：${info ? `Gitea ${info.version}` : '版本未知'}`,
        '点击查看更多操作',
      ].join('\n');
    } catch (error) {
      logDebug('状态栏刷新失败', error);
      this.item.text = '$(warning) Gitea: 连接异常';
      this.item.tooltip = '访问令牌可能已失效，点击重新设置';
    }
    this.item.show();
  }

  /** 释放资源。 */
  public dispose(): void {
    this.item.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  /** 弹出操作菜单。 */
  private async showMenu(): Promise<void> {
    const picked = await vscode.window.showQuickPick(
      [
        { label: '$(refresh) 刷新全部视图', command: 'gitea.refresh' },
        { label: '$(account) 显示当前登录用户', command: 'gitea.showCurrentUser' },
        { label: '$(versions) 检查版本兼容性', command: 'gitea.checkCompatibility' },
        { label: '$(cloud-download) 检查扩展更新', command: 'gitea.checkForUpdates' },
        { label: '$(key) 设置访问令牌', command: 'gitea.setToken' },
        { label: '$(clippy) 复制 MCP 配置', command: 'gitea.copyMcpConfig' },
        { label: '$(tools) 写入 CodeBuddy MCP 配置', command: 'gitea.writeCodeBuddyUserMcpConfig' },
        { label: '$(file-code) 写入 MCP 配置文件（工作区）', command: 'gitea.writeMcpConfig' },
        { label: '$(output) 显示日志', command: 'gitea.showOutput' },
        { label: '$(trash) 清除访问令牌', command: 'gitea.clearToken' },
      ],
      { title: 'Gitea 操作' },
    );
    if (picked) {
      await vscode.commands.executeCommand(picked.command);
    }
  }
}
