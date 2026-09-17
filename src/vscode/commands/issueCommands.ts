/**
 * Issue 类命令：新建、回复（进详情面板）、关闭 / 重新打开。
 *
 * 「回复」不再使用单行输入框——Markdown 评论需要多行编辑与上下文（历史评论、
 * 标签、变更文件），因此统一转到 {@link DetailPanel} 内完成。
 */
import * as vscode from 'vscode';
import { describeError } from '../../core/errors';
import { logError } from '../logger';
import { DetailPanel } from '../views/detail/detailPanel';
import { buildPanelDeps } from './panel';
import { pickLabels, readIndexedPayload, requireRepoRef } from './pickers';
import type { CommandDeps, CommandMap } from './types';

/**
 * 创建 Issue 类命令。
 * @param deps 命令依赖
 * @returns 命令映射
 */
export function createIssueCommands(deps: CommandDeps): CommandMap {
  const { service } = deps;
  const panelDeps = buildPanelDeps(deps);

  return {
    /** 新建 Issue。 */
    'gitea.createIssue': async (node) => {
      const ref = await requireRepoRef(service, node);
      if (!ref) {
        return;
      }

      const title = await vscode.window.showInputBox({
        title: `在 ${ref.owner}/${ref.repo} 新建 Issue`,
        prompt: 'Issue 标题',
        ignoreFocusOut: true,
        validateInput: (value) => (value.trim().length > 0 ? undefined : '标题不能为空'),
      });
      if (!title) {
        return;
      }

      const body = await vscode.window.showInputBox({
        title: 'Issue 正文（可留空，支持 Markdown）',
        ignoreFocusOut: true,
      });
      if (body === undefined) {
        return;
      }

      const labels = await pickLabels(service, ref);
      if (labels === undefined) {
        return;
      }

      try {
        const operations = await service.getOperations();
        const issue = await operations.issues.create(ref.owner, ref.repo, {
          title: title.trim(),
          body: body.trim() || undefined,
          labels: labels.length > 0 ? labels : undefined,
        });
        deps.providers.issues.refresh();
        deps.providers.repos.refresh();
        DetailPanel.show(panelDeps, {
          owner: ref.owner,
          repo: ref.repo,
          number: issue.number,
          kind: 'issue',
        });
      } catch (error) {
        logError('创建 Issue 失败', error);
        void vscode.window.showErrorMessage(`创建 Issue 失败：${describeError(error)}`);
      }
    },

    /** 打开详情面板并聚焦回复框。 */
    'gitea.commentIssue': async (node) => {
      const payload = readIndexedPayload(node);
      if (!payload) {
        void vscode.window.showWarningMessage('请在 Issue 或 Pull Request 节点上执行该命令。');
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

    /** 切换 Issue / PR 的打开 / 关闭状态。 */
    'gitea.toggleIssueState': async (node) => {
      const payload = readIndexedPayload(node);
      if (!payload) {
        void vscode.window.showWarningMessage('请在 Issue 或 Pull Request 节点上执行该命令。');
        return;
      }

      try {
        const operations = await service.getOperations();
        const kind = payload.kind ?? 'issue';
        const current =
          kind === 'pull'
            ? (await operations.pulls.get(payload.owner, payload.repo, payload.number)).state
            : (await operations.issues.get(payload.owner, payload.repo, payload.number)).state;
        const nextState = current === 'open' ? 'closed' : 'open';

        if (kind === 'pull') {
          await operations.pulls.update(payload.owner, payload.repo, payload.number, { state: nextState });
        } else {
          await operations.issues.update(payload.owner, payload.repo, payload.number, { state: nextState });
        }

        deps.providers.issues.refresh();
        deps.providers.pulls.refresh();
        deps.providers.repos.refresh();
        void vscode.window.showInformationMessage(
          `#${payload.number} 已${nextState === 'closed' ? '关闭' : '重新打开'}`,
        );
      } catch (error) {
        logError('切换状态失败', error);
        void vscode.window.showErrorMessage(`切换状态失败：${describeError(error)}`);
      }
    },
  };
}
