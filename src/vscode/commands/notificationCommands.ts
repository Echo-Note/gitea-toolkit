/**
 * 通知类命令。
 */
import * as vscode from 'vscode';
import { describeError } from '../../core/errors';
import { logError } from '../logger';
import type { GiteaNode } from '../views/nodes';
import type { CommandDeps, CommandMap } from './types';

/**
 * 创建通知类命令。
 * @param deps 命令依赖
 * @returns 命令映射
 */
export function createNotificationCommands(deps: CommandDeps): CommandMap {
  const { service } = deps;

  return {
    /** 将单条通知标记为已读。 */
    'gitea.markNotificationRead': async (node) => {
      const payload = (node as GiteaNode | undefined)?.payload as { id?: number } | undefined;
      if (typeof payload?.id !== 'number') {
        void vscode.window.showWarningMessage('请在通知节点上执行该命令。');
        return;
      }
      try {
        const operations = await service.getOperations();
        await operations.misc.markThreadRead(payload.id);
        deps.providers.notifications.refresh();
        void vscode.window.showInformationMessage('已标记为已读。');
      } catch (error) {
        logError('标记通知已读失败', error);
        void vscode.window.showErrorMessage(`标记失败：${describeError(error)}`);
      }
    },

    /** 将全部通知标记为已读。 */
    'gitea.markAllNotificationsRead': async () => {
      const confirmed = await vscode.window.showWarningMessage(
        '确定要把全部未读通知标记为已读吗？',
        { modal: true },
        '全部标记',
      );
      if (confirmed !== '全部标记') {
        return;
      }
      try {
        const operations = await service.getOperations();
        await operations.misc.markNotifications({ all: true, toStatus: 'read' });
        deps.providers.notifications.refresh();
        void vscode.window.showInformationMessage('已把全部通知标记为已读。');
      } catch (error) {
        logError('批量标记通知已读失败', error);
        void vscode.window.showErrorMessage(`标记失败：${describeError(error)}`);
      }
    },
  };
}
