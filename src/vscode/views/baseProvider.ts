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
