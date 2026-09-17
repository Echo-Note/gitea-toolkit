/**
 * Issue / PR 详情交互面板。
 *
 * 这是「回复、关闭、合并、评审」等操作的主入口：Webview 只负责展示与上报意图，
 * 真正的 API 调用、确认弹窗、错误处理全部在扩展宿主完成，因此访问令牌不会进入 Webview。
 *
 * 同一仓库下的同一个 Issue/PR 复用同一个面板：重复打开只做聚焦与刷新。
 */
import * as vscode from 'vscode';
import { describeError } from '../../../core/errors';
import { readSettings } from '../../config';
import { isGitRepository, runGit } from '../../git';
import { logError, logInfo } from '../../logger';
import type { GiteaService } from '../../service';
import { buildDetail, type DetailTarget, type DetailViewModel } from './detailContent';
import { buildDetailHtml } from './detailHtml';

/** 面板依赖。 */
export interface DetailPanelDeps {
  /** 扩展上下文。 */
  context: vscode.ExtensionContext;
  /** Gitea 服务。 */
  service: GiteaService;
  /** 写操作成功后的回调（用于刷新侧边栏视图）。 */
  onDidMutate?: () => void;
}

/** Webview 上报的消息。 */
interface PanelMessage {
  type: string;
  body?: string;
  closeAfter?: boolean;
  state?: 'open' | 'closed';
  event?: string;
  strategy?: string;
  deleteBranch?: boolean;
  url?: string;
}

/** 详情面板控制器。 */
export class DetailPanel {
  /** 已打开的面板，键为 `kind:owner/repo#number`。 */
  private static readonly panels = new Map<string, DetailPanel>();

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private model: DetailViewModel | undefined;

  /**
   * 打开（或聚焦）详情面板。
   * @param deps 依赖
   * @param target 目标坐标
   * @param options 打开选项
   * @returns 面板控制器
   */
  public static show(
    deps: DetailPanelDeps,
    target: DetailTarget,
    options: { focusComposer?: boolean } = {},
  ): DetailPanel {
    const key = `${target.kind}:${target.owner}/${target.repo}#${target.number}`;
    const existing = DetailPanel.panels.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Active);
      void existing.reload(options.focusComposer ? { focusComposer: true } : {});
      return existing;
    }
    const created = new DetailPanel(deps, target, key);
    DetailPanel.panels.set(key, created);
    void created.reload(options.focusComposer ? { focusComposer: true } : {});
    return created;
  }

  private constructor(
    private readonly deps: DetailPanelDeps,
    private readonly target: DetailTarget,
    private readonly key: string,
  ) {
    const settings = readSettings();
    this.panel = vscode.window.createWebviewPanel(
      'gitea.detail',
      `#${target.number}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [deps.context.extensionUri],
      },
    );
    this.panel.webview.html = buildDetailHtml(this.panel.webview, settings.serverUrl);
    this.panel.iconPath = new vscode.ThemeIcon(target.kind === 'pull' ? 'git-pull-request' : 'issue-opened');

    this.disposables.push(this.panel.webview.onDidReceiveMessage((message: PanelMessage) => this.handle(message)));
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  /**
   * 重新加载并渲染详情。
   * @param options 渲染选项
   */
  public async reload(options: { focusComposer?: boolean; silent?: boolean } = {}): Promise<void> {
    if (!options.silent) {
      await this.setBusy(true);
    }
    try {
      const operations = await this.deps.service.getOperations();
      this.model = await buildDetail(operations, this.target);
      this.panel.title = `#${this.model.number} ${truncateTitle(this.model.title)}`;
      await this.panel.webview.postMessage({ type: 'render', view: this.model });
      if (options.focusComposer) {
        await this.panel.webview.postMessage({ type: 'focusComposer' });
      }
    } catch (error) {
      logError('加载详情失败', error);
      void vscode.window.showErrorMessage(`加载详情失败：${describeError(error)}`);
    } finally {
      if (!options.silent) {
        await this.setBusy(false);
      }
    }
  }

  /**
   * 处理 Webview 上报的消息。
   * @param message 消息体
   */
  private async handle(message: PanelMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'ready':
        case 'refresh':
          await this.reload({ silent: message.type === 'ready' });
          break;
        case 'openExternal':
          await this.openExternal(message.url);
          break;
        case 'reply':
          await this.reply(message);
          break;
        case 'setState':
          await this.setState(message.state);
          break;
        case 'review':
          await this.review(message);
          break;
        case 'merge':
          await this.merge(message);
          break;
        case 'checkout':
          await this.checkout();
          break;
        default:
          logInfo(`忽略未知的面板消息：${message.type}`);
      }
    } catch (error) {
      logError(`面板操作 ${message.type} 失败`, error);
      void vscode.window.showErrorMessage(`操作失败：${describeError(error)}`);
      await this.setBusy(false);
    }
  }

  /**
   * 发表评论（可选同时关闭）。
   * @param message 消息体
   */
  private async reply(message: PanelMessage): Promise<void> {
    const body = (message.body ?? '').trim();
    if (body.length === 0) {
      return;
    }
    await this.setBusy(true);
    const operations = await this.deps.service.getOperations();
    const { owner, repo, number } = this.target;

    await operations.issues.createComment(owner, repo, number, body);
    if (message.closeAfter) {
      await this.applyState('closed', false);
    }

    await this.panel.webview.postMessage({ type: 'clearDraft' });
    await this.afterMutate(message.closeAfter ? '已发表评论并关闭' : '已发表评论');
  }

  /**
   * 关闭 / 重新打开。
   * @param state 目标状态
   */
  private async setState(state: 'open' | 'closed' | undefined): Promise<void> {
    if (state !== 'open' && state !== 'closed') {
      return;
    }
    await this.setBusy(true);
    await this.applyState(state, true);
    await this.afterMutate(state === 'closed' ? '已关闭' : '已重新打开');
  }

  /**
   * 提交评审。
   * @param message 消息体
   */
  private async review(message: PanelMessage): Promise<void> {
    const event = message.event;
    if (event !== 'APPROVED' && event !== 'REQUEST_CHANGES' && event !== 'COMMENT') {
      return;
    }
    const body = (message.body ?? '').trim();
    if (event === 'REQUEST_CHANGES' && body.length === 0) {
      void vscode.window.showWarningMessage('「请求修改」需要填写说明，请先在回复框中写下理由。');
      return;
    }
    await this.setBusy(true);
    const operations = await this.deps.service.getOperations();
    const { owner, repo, number } = this.target;
    await operations.pulls.createReview(owner, repo, number, { event, body: body || undefined });
    if (body.length > 0) {
      await this.panel.webview.postMessage({ type: 'clearDraft' });
    }
    const text = event === 'APPROVED' ? '已批准' : event === 'REQUEST_CHANGES' ? '已请求修改' : '已提交评审';
    await this.afterMutate(text);
  }

  /**
   * 合并 PR（合并前二次确认，避免误点）。
   * @param message 消息体
   */
  private async merge(message: PanelMessage): Promise<void> {
    const strategy = message.strategy ?? 'merge';
    const confirmed = await vscode.window.showWarningMessage(
      `确认以 ${strategy} 方式合并 #${this.target.number}？`,
      { modal: true },
      '合并',
    );
    if (confirmed !== '合并') {
      return;
    }
    await this.setBusy(true);
    const operations = await this.deps.service.getOperations();
    const { owner, repo, number } = this.target;
    await operations.pulls.merge(owner, repo, number, {
      strategy: strategy as 'merge',
      deleteBranchAfterMerge: message.deleteBranch ?? false,
    });
    await this.afterMutate('已合并');
  }

  /** 检出 PR 源分支到本地。 */
  private async checkout(): Promise<void> {
    if (this.target.kind !== 'pull') {
      return;
    }
    if (!(await isGitRepository())) {
      void vscode.window.showWarningMessage('当前工作区不是 git 仓库，无法检出分支。');
      return;
    }
    await this.setBusy(true);
    const operations = await this.deps.service.getOperations();
    const { owner, repo, number } = this.target;
    const pull = await operations.pulls.get(owner, repo, number);
    const headRef = pull.head?.ref;
    if (!headRef) {
      throw new Error('该 PR 缺少源分支信息');
    }
    const headOwner = pull.head?.repo?.owner?.login ?? owner;
    if (headOwner !== owner) {
      void vscode.window.showWarningMessage(`该 PR 来自 fork（${headOwner}），请手动添加远端后再检出。`);
      await this.setBusy(false);
      return;
    }
    const fetch = await runGit(['fetch', 'origin', headRef]);
    if (fetch.exitCode !== 0) {
      throw new Error(fetch.stderr.trim() || `git fetch origin ${headRef} 失败`);
    }
    const checkout = await runGit(['checkout', headRef]);
    if (checkout.exitCode !== 0) {
      throw new Error(checkout.stderr.trim() || `git checkout ${headRef} 失败`);
    }
    await this.setBusy(false);
    void vscode.window.showInformationMessage(`已检出分支 ${headRef}`);
  }

  /**
   * 更新 Issue / PR 状态。
   * @param state 目标状态
   * @param withBusy 是否自行管理忙碌态
   */
  private async applyState(state: 'open' | 'closed', withBusy: boolean): Promise<void> {
    const operations = await this.deps.service.getOperations();
    const { owner, repo, number } = this.target;
    if (this.target.kind === 'pull') {
      await operations.pulls.update(owner, repo, number, { state });
    } else {
      await operations.issues.update(owner, repo, number, { state });
    }
    if (withBusy) {
      await this.setBusy(false);
    }
  }

  /**
   * 写操作成功后的统一收尾：提示、刷新面板与侧边栏。
   * @param message 提示文案
   */
  private async afterMutate(message: string): Promise<void> {
    void vscode.window.showInformationMessage(`#${this.target.number} ${message}`);
    this.deps.onDidMutate?.();
    await this.reload();
  }

  /**
   * 在系统浏览器中打开链接。
   * @param url 链接
   */
  private async openExternal(url: string | undefined): Promise<void> {
    if (!url) {
      return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }

  /**
   * 切换忙碌态。
   * @param value 是否忙碌
   */
  private async setBusy(value: boolean): Promise<void> {
    await this.panel.webview.postMessage({ type: 'busy', value });
  }

  /** 释放面板资源。 */
  private dispose(): void {
    DetailPanel.panels.delete(this.key);
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}

/**
 * 面板标题过长时截断。
 * @param title 原始标题
 * @param max 最大长度
 * @returns 截断后的标题
 */
function truncateTitle(title: string, max = 40): string {
  const text = title.trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
