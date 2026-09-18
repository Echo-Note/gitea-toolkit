/**
 * 命令注册入口。
 */
import * as vscode from 'vscode';
import { logError } from '../logger';
import { createActionCommands } from './actionCommands';
import { createAuthCommands } from './authCommands';
import { createIssueCommands } from './issueCommands';
import { createMcpCommands } from './mcpCommands';
import { createNavigationCommands } from './navigationCommands';
import { createNotificationCommands } from './notificationCommands';
import { createPullCommands } from './pullCommands';
import { createRepoCommands } from './repoCommands';
import { createUpdateCommands } from './updateCommands';
import type { CommandDeps, CommandMap } from './types';

export type { CommandDeps, CommandMap, ProviderBundle } from './types';

/**
 * 汇总所有命令处理器。
 * @param deps 命令依赖
 * @returns 命令映射
 */
export function createCommands(deps: CommandDeps): CommandMap {
  return {
    ...createAuthCommands(deps),
    ...createNavigationCommands(deps),
    ...createRepoCommands(deps),
    ...createIssueCommands(deps),
    ...createPullCommands(deps),
    ...createNotificationCommands(deps),
    ...createMcpCommands(deps),
    ...createUpdateCommands(deps),
    ...createActionCommands(deps),
  };
}

/**
 * 把命令映射注册到扩展上下文。
 * 单个命令抛出异常不会影响其他命令，异常统一写入日志并提示用户。
 * @param context 扩展上下文
 * @param commands 命令映射
 */
export function registerCommands(context: vscode.ExtensionContext, commands: CommandMap): void {
  for (const [id, handler] of Object.entries(commands)) {
    const wrapped = async (...args: unknown[]): Promise<void> => {
      try {
        await handler(...args);
      } catch (error) {
        logError(`命令 ${id} 执行失败`, error);
        void vscode.window.showErrorMessage(`Gitea 命令失败：${(error as Error).message}`);
      }
    };
    context.subscriptions.push(vscode.commands.registerCommand(id, wrapped));
  }
}
