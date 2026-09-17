/**
 * 导航类命令：详情交互面板、浏览器打开、查看 PR 差异。
 *
 * `gitea.openIssue` / `gitea.openPull` 是「回复、关闭、合并、评审」的入口，
 * 统一打开 {@link DetailPanel}——侧边栏只是索引，真正的操作都在详情面板里完成。
 */
import * as vscode from 'vscode';
import { describeError } from '../../core/errors';
import { logError } from '../logger';
import { DetailPanel } from '../views/detail/detailPanel';
import { resolveNodeWebUrl } from './nodeUrl';
import { buildPanelDeps } from './panel';
import { readIndexedPayload } from './pickers';
import type { CommandDeps, CommandMap } from './types';

/**
 * 创建导航类命令。
 * @param deps 命令依赖
 * @returns 命令映射
 */
export function createNavigationCommands(deps: CommandDeps): CommandMap {
  const { service } = deps;
  const panelDeps = buildPanelDeps(deps);

  return {
    /** 在系统浏览器中打开对应页面。 */
    'gitea.openInBrowser': async (node) => {
      const url = resolveNodeWebUrl(node);
      if (!url) {
        void vscode.window.showWarningMessage(
          '无法确定该条目的网页地址，请检查 gitea.serverUrl 是否配置正确。',
        );
        return;
      }
      await vscode.env.openExternal(vscode.Uri.parse(url));
    },

    /** 打开 Issue 详情面板（可回复、关闭）。 */
    'gitea.openIssue': async (node) => {
      const payload = readIndexedPayload(node);
      if (!payload) {
        void vscode.window.showWarningMessage('请从「Gitea」侧边栏的 Issue 节点上执行该命令。');
        return;
      }
      DetailPanel.show(
        panelDeps,
        { owner: payload.owner, repo: payload.repo, number: payload.number, kind: 'issue' },
        { focusComposer: false },
      );
    },

    /** 打开 Pull Request 详情面板（可回复、评审、合并、检出）。 */
    'gitea.openPull': async (node) => {
      const payload = readIndexedPayload(node);
      if (!payload) {
        void vscode.window.showWarningMessage('请从「Gitea」侧边栏的 Pull Request 节点上执行该命令。');
        return;
      }
      DetailPanel.show(
        panelDeps,
        { owner: payload.owner, repo: payload.repo, number: payload.number, kind: 'pull' },
        { focusComposer: false },
      );
    },

    /** 打开 PR 详情面板并聚焦回复框（用于命令面板 / 快捷键快速回复）。 */
    'gitea.replyCurrent': async (node) => {
      const payload = readIndexedPayload(node);
      if (!payload) {
        void vscode.window.showWarningMessage('请从「Gitea」侧边栏的 Issue 或 Pull Request 节点上执行该命令。');
        return;
      }
      DetailPanel.show(
        panelDeps,
        {
          owner: payload.owner,
          repo: payload.repo,
          number: payload.number,
          kind: payload.kind ?? 'issue',
        },
        { focusComposer: true },
      );
    },

    /** 以 diff 视图展示 PR 的代码差异。 */
    'gitea.showPullDiff': async (node) => {
      const payload = readIndexedPayload(node);
      if (!payload) {
        void vscode.window.showWarningMessage('请从「Gitea」侧边栏的 Pull Request 节点上执行该命令。');
        return;
      }
      try {
        const operations = await service.getOperations();
        const diff = await operations.pulls.getDiff(payload.owner, payload.repo, payload.number);
        const document = await vscode.workspace.openTextDocument({ content: diff, language: 'diff' });
        await vscode.window.showTextDocument(document, { preview: true });
      } catch (error) {
        logError('获取 PR 差异失败', error);
        void vscode.window.showErrorMessage(`获取差异失败：${describeError(error)}`);
      }
    },
  };
}
