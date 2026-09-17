/**
 * Pull Request 类命令：新建、合并、检出。
 */
import * as vscode from 'vscode';
import { describeError } from '../../core/errors';
import { logError } from '../logger';
import { isGitRepository, runGit } from '../git';
import { pickBranch, readIndexedPayload, requireRepoRef } from './pickers';
import type { CommandDeps, CommandMap } from './types';

/**
 * 创建 Pull Request 类命令。
 * @param deps 命令依赖
 * @returns 命令映射
 */
export function createPullCommands(deps: CommandDeps): CommandMap {
  const { service } = deps;

  return {
    /** 新建 Pull Request。 */
    'gitea.createPull': async (node) => {
      const ref = await requireRepoRef(service, node);
      if (!ref) {
        return;
      }
      const operations = await service.getOperations();

      let defaultBranch: string | undefined;
      try {
        defaultBranch = (await operations.repos.get(ref.owner, ref.repo)).default_branch;
      } catch (error) {
        logError('读取仓库信息失败', error);
      }

      const base = await pickBranch(service, ref, { title: '选择目标分支（base）', default: defaultBranch });
      if (!base) {
        return;
      }
      const head = await pickBranch(service, ref, { title: '选择源分支（head）', default: defaultBranch });
      if (!head) {
        return;
      }
      if (head === base) {
        void vscode.window.showWarningMessage('源分支与目标分支不能相同。');
        return;
      }

      const title = await vscode.window.showInputBox({
        title: `新建 PR：${head} → ${base}`,
        prompt: 'PR 标题',
        value: head,
        ignoreFocusOut: true,
        validateInput: (value) => (value.trim().length > 0 ? undefined : '标题不能为空'),
      });
      if (!title) {
        return;
      }

      const body = await vscode.window.showInputBox({
        title: 'PR 描述（可留空，支持 Markdown）',
        ignoreFocusOut: true,
      });
      if (body === undefined) {
        return;
      }

      try {
        const pull = await operations.pulls.create(ref.owner, ref.repo, {
          title: title.trim(),
          head,
          base,
          body: body.trim() || undefined,
        });
        deps.providers.pulls.refresh();
        deps.providers.repos.refresh();
        const action = await vscode.window.showInformationMessage(
          `已创建 Pull Request #${pull.number}`,
          '在浏览器打开',
          '查看详情',
        );
        if (action === '在浏览器打开' && pull.html_url) {
          await vscode.env.openExternal(vscode.Uri.parse(pull.html_url));
        } else if (action === '查看详情') {
          await vscode.commands.executeCommand('gitea.openPull', {
            payload: { owner: ref.owner, repo: ref.repo, number: pull.number },
          });
        }
      } catch (error) {
        logError('创建 Pull Request 失败', error);
        void vscode.window.showErrorMessage(`创建 Pull Request 失败：${describeError(error)}`);
      }
    },

    /** 合并 Pull Request。 */
    'gitea.mergePull': async (node) => {
      const payload = readIndexedPayload(node);
      if (!payload?.owner || !payload.repo || payload.number === undefined) {
        void vscode.window.showWarningMessage('请在 Pull Request 节点上执行该命令。');
        return;
      }

      const operations = await service.getOperations();
      let pull;
      try {
        pull = await operations.pulls.get(payload.owner, payload.repo, payload.number);
      } catch (error) {
        logError('读取 PR 失败', error);
        void vscode.window.showErrorMessage(`读取 Pull Request 失败：${describeError(error)}`);
        return;
      }

      if (pull.merged) {
        void vscode.window.showInformationMessage(`#${payload.number} 已经合并。`);
        return;
      }
      if (pull.mergeable === false) {
        void vscode.window.showWarningMessage(`#${payload.number} 当前存在冲突，无法合并。`);
        return;
      }

      const strategy = await vscode.window.showQuickPick(
        [
          { label: 'merge', description: '创建合并提交', value: 'merge' as const },
          { label: 'squash', description: '压缩为单个提交', value: 'squash' as const },
          { label: 'rebase', description: '变基合并', value: 'rebase' as const },
          { label: 'rebase-merge', description: '变基并保留合并提交', value: 'rebase-merge' as const },
          { label: 'fast-forward-only', description: '仅允许快进', value: 'fast-forward-only' as const },
        ],
        { title: `合并 #${payload.number}：${pull.title}`, placeHolder: '选择合并方式' },
      );
      if (!strategy) {
        return;
      }

      const deleteBranch = await vscode.window.showQuickPick(
        [
          { label: '合并后删除源分支', value: true },
          { label: '保留源分支', value: false },
        ],
        { title: '源分支处理方式' },
      );
      if (!deleteBranch) {
        return;
      }

      const confirmed = await vscode.window.showWarningMessage(
        `确认以 ${strategy.label} 方式合并 #${payload.number}？`,
        { modal: true },
        '合并',
      );
      if (confirmed !== '合并') {
        return;
      }

      try {
        await operations.pulls.merge(payload.owner, payload.repo, payload.number, {
          strategy: strategy.value,
          deleteBranchAfterMerge: deleteBranch.value,
        });
        deps.providers.pulls.refresh();
        deps.providers.repos.refresh();
        void vscode.window.showInformationMessage(`#${payload.number} 已合并。`);
      } catch (error) {
        logError('合并 Pull Request 失败', error);
        void vscode.window.showErrorMessage(`合并失败：${describeError(error)}`);
      }
    },

    /** 检出 PR 的源分支到本地。 */
    'gitea.checkoutPull': async (node) => {
      const payload = readIndexedPayload(node);
      if (!payload?.owner || !payload.repo || payload.number === undefined) {
        void vscode.window.showWarningMessage('请在 Pull Request 节点上执行该命令。');
        return;
      }
      if (!(await isGitRepository())) {
        void vscode.window.showWarningMessage('当前工作区不是 git 仓库，无法检出分支。');
        return;
      }

      try {
        const operations = await service.getOperations();
        const pull = await operations.pulls.get(payload.owner, payload.repo, payload.number);
        const headRef = pull.head?.ref;
        if (!headRef) {
          void vscode.window.showWarningMessage('该 PR 缺少源分支信息。');
          return;
        }
        const headOwner = pull.head?.repo?.owner?.login ?? payload.owner;
        if (headOwner !== payload.owner) {
          void vscode.window.showWarningMessage(
            `该 PR 来自 fork（${headOwner}），请手动添加远端后再检出。`,
          );
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
        void vscode.window.showInformationMessage(`已检出分支 ${headRef}`);
      } catch (error) {
        logError('检出 PR 分支失败', error);
        void vscode.window.showErrorMessage(`检出失败：${describeError(error)}`);
      }
    },
  };
}
