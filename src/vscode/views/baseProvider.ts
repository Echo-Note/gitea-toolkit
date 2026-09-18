/**
 * 树视图基类。
 *
 * 统一处理：刷新事件、错误到消息节点的降级、以及子节点懒加载。
 */
import * as vscode from 'vscode';
import { describeError, GiteaConfigError } from '../../core/errors';
import { logError, logWarn } from '../logger';
import type { GiteaService } from '../service';
import { messageIcons } from './icons';
import { GiteaNode, createMessageNode } from './nodes';

/** 树视图提供者基类。 */
export abstract class BaseTreeProvider implements vscode.TreeDataProvider<GiteaNode> {
  protected readonly changeEmitter = new vscode.EventEmitter<GiteaNode | undefined | void>();

  /**
   * 各列表「当前已加载条数」的上限，用于「加载更多」的增量展示。
   *
   * 为什么需要它：单次能拉多少条受服务端 `max_response_items`（默认 50）限制，
   * 但**可以翻页**，所以「想看更多」不该靠不断调大配置 —— 那样总要面对一个新的上限。
   * 改成先给一批、底部留一个「加载更多」，就没有硬上限了。
   */
  private readonly loadCaps = new Map<string, number>();

  /** 数据变化事件。 */
  public readonly onDidChangeTreeData: vscode.Event<GiteaNode | undefined | void> = this.changeEmitter.event;

  /**
   * @param service Gitea 服务
   */
  protected constructor(protected readonly service: GiteaService) {}

  /** 刷新视图。 */
  public refresh(node?: GiteaNode): void {
    this.changeEmitter.fire(node);
  }

  /**
   * 读取某个列表当前的展示上限。
   * @param key 列表标识（需在提供者内唯一，如 `issues:owner/repo`）
   * @param base 未点过「加载更多」时的初始上限（一般取 `gitea.pageSize`）
   * @returns 当前上限
   */
  public capOf(key: string, base: number): number {
    return this.loadCaps.get(key) ?? base;
  }

  /**
   * 提高某个列表的展示上限（供「加载更多」命令调用）。
   * @param key 列表标识
   * @param base 初始上限
   * @param step 本次增加的条数
   */
  public raiseCap(key: string, base: number, step: number): void {
    this.loadCaps.set(key, this.capOf(key, base) + step);
  }

  /** @inheritdoc */
  public getTreeItem(element: GiteaNode): vscode.TreeItem {
    return element;
  }

  /** @inheritdoc */
  public async getChildren(element?: GiteaNode): Promise<GiteaNode[]> {
    try {
      if (element) {
        return element.loadChildren ? await element.loadChildren() : [];
      }
      return await this.getRootNodes();
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * 加载根节点。
   * @returns 节点数组
   */
  protected abstract getRootNodes(): Promise<GiteaNode[]>;

  /**
   * 统一错误处理：配置缺失给出引导按钮，其余降级为错误消息节点。
   * @param error 异常
   * @returns 消息节点数组
   */
  protected handleError(error: unknown): GiteaNode[] {
    if (error instanceof GiteaConfigError) {
      logWarn(`视图加载被跳过：${error.message}`);
      return [
        createMessageNode(error.message, messageIcons.noToken, {
          command: 'gitea.setToken',
          title: '设置访问令牌',
        }),
      ];
    }
    logError('视图加载失败', error);
    return [createMessageNode(describeError(error), messageIcons.error)];
  }

  /**
   * 释放资源。
   */
  public dispose(): void {
    this.changeEmitter.dispose();
  }
}
