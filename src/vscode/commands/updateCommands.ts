/**
 * 扩展自身更新检查相关的命令。
 *
 * 与「Gitea: 检查版本兼容性」的区别：那个检查的是**服务端** Gitea 的版本，
 * 这里检查的是**扩展自身**是否有新版本可用。
 *
 * 定位是**兜底**：从扩展市场安装的由编辑器自动更新，这个命令主要服务手动装 `.vsix` 的用户。
 */
import * as vscode from 'vscode';
import { checkForUpdates, showUpdatePrompt } from '../updateChecker';
import { logError } from '../logger';
import type { CommandDeps, CommandMap } from './types';

/**
 * 创建更新检查命令。
 * @param deps 命令依赖
 * @returns 命令映射
 */
export function createUpdateCommands(deps: CommandDeps): CommandMap {
  const { context } = deps;

  return {
    /** 手动检查扩展自身是否有新版本。 */
    'gitea.checkForUpdates': async () => {
      try {
        const info = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: '正在检查 Gitea Toolkit 更新…',
          },
          () => checkForUpdates(context, { manual: true }),
        );
        if (!info) {
          // checkForUpdates 已在手动模式下给出失败原因
          return;
        }
        if (info.hasUpdate) {
          await showUpdatePrompt(info);
          return;
        }
        const action = await vscode.window.showInformationMessage(
          `Gitea Toolkit 已是最新版本（${info.current}）。` +
            '这里比对的是 GitHub Releases；若你从扩展市场安装，编辑器也会自动更新。',
          '打开 Releases 页面',
        );
        if (action === '打开 Releases 页面') {
          await vscode.env.openExternal(vscode.Uri.parse(info.releaseUrl));
        }
      } catch (error) {
        logError('检查更新失败', error);
        void vscode.window.showErrorMessage(`检查更新失败：${(error as Error).message}`);
      }
    },
  };
}
