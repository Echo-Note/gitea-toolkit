/**
 * 「通知」视图：展示当前用户的未读 Gitea 通知。
 */
import * as vscode from 'vscode';
import { readSettings } from '../config';
import type { GiteaService } from '../service';
import { BaseTreeProvider } from './baseProvider';
import { messageIcons, notificationIcon } from './icons';
import {
  createMessageNode,
  createMoreNode,
  GiteaNode,
  toThemeIcon,
  type NotificationNodePayload,
} from './nodes';

/** 通知树视图提供者。 */
export class NotificationsProvider extends BaseTreeProvider {
  constructor(service: GiteaService) {
    super(service);
  }

  /** @inheritdoc */
  protected async getRootNodes(): Promise<GiteaNode[]> {
    const operations = await this.service.getOperations();
    const settings = readSettings();
    const key = 'notifications';
    const result = await operations.misc.listNotifications({
      limit: this.capOf(key, settings.pageSize),
    });

    if (result.items.length === 0) {
      return [createMessageNode('没有未读通知。', messageIcons.noNotification)];
    }

    const nodes = result.items.map((thread) => {
      const payload: NotificationNodePayload = {
        id: thread.id,
        title: thread.subject.title,
        subjectType: thread.subject.type,
        repoFullName: thread.repository?.full_name,
        // 部分 Gitea 版本的通知主题不带 html_url，回退到仓库首页，避免「点了没反应」
        htmlUrl: thread.subject.html_url ?? thread.repository?.html_url,
        unread: thread.unread,
      };
      const node = new GiteaNode(
        'notification',
        thread.subject.title,
        vscode.TreeItemCollapsibleState.None,
        payload,
      );
      node.description = `${thread.repository?.full_name ?? ''}${thread.unread ? ' · 未读' : ''}`;
      node.iconPath = toThemeIcon(notificationIcon(thread.subject.type, Boolean(thread.unread)));
      node.tooltip = new vscode.MarkdownString(
        `**${thread.subject.title}**\n\n仓库：\`${thread.repository?.full_name ?? '-'}\`\n\n类型：${thread.subject.type ?? '-'}`,
      );
      node.command = {
        command: 'gitea.openInBrowser',
        title: '在浏览器打开',
        arguments: [node],
      };
      return node;
    });
    if (result.pageInfo.hasNextPage) {
      nodes.push(
        createMoreNode({
          provider: 'notifications',
          listKey: key,
          step: settings.pageSize,
          loaded: result.items.length,
        }),
      );
    }
    return nodes;
  }
}
