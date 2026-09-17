/**
 * 仓库类命令：克隆、新建仓库、新建分支。
 */
import * as vscode from 'vscode';
import { describeError } from '../../core/errors';
import { readSettings } from '../config';
import { logError } from '../logger';
import { pickBranch, requireRepoRef } from './pickers';
import type { CommandDeps, CommandMap } from './types';

/** Git 分支名合法性校验（放宽版，足以拦截常见误输入）。 */
const BRANCH_NAME_PATTERN = /^(?!\/|.*(?:[/.]\.|\/\/|@\{|\\))[^\s~^:?*[\\]+$/;

/**
 * 创建仓库类命令。
 * @param deps 命令依赖
 * @returns 命令映射
 */
export function createRepoCommands(deps: CommandDeps): CommandMap {
  const { service, context } = deps;

  return {
    /** 克隆仓库到本地（借助内置 Git 扩展的克隆流程）。 */
    'gitea.cloneRepo': async (node) => {
      const ref = await requireRepoRef(service, node);
      if (!ref) {
        return;
      }
      try {
        const operations = await service.getOperations();
        const repo = await operations.repos.get(ref.owner, ref.repo);
        const url = repo.clone_url ?? repo.html_url;
        await vscode.commands.executeCommand('git.clone', url);
      } catch (error) {
        logError('克隆仓库失败', error);
        void vscode.window.showErrorMessage(`克隆仓库失败：${describeError(error)}`);
      }
    },

    /** 新建仓库。 */
    'gitea.createRepo': async () => {
      const settings = readSettings();
      const name = await vscode.window.showInputBox({
        title: '新建 Gitea 仓库',
        prompt: '仓库名称',
        ignoreFocusOut: true,
        validateInput: (value) =>
          /^[A-Za-z0-9._-]+$/.test(value.trim()) ? undefined : '仓库名只能包含字母、数字、点、下划线与连字符',
      });
      if (!name) {
        return;
      }

      const description = await vscode.window.showInputBox({
        title: '仓库描述（可留空）',
        ignoreFocusOut: true,
      });
      if (description === undefined) {
        return;
      }

      const visibility = await vscode.window.showQuickPick(
        [
          { label: '私有', value: true },
          { label: '公开', value: false },
        ],
        { title: '仓库可见性' },
      );
      if (!visibility) {
        return;
      }

      try {
        const operations = await service.getOperations();
        const created = await operations.repos.create({
          name: name.trim(),
          owner: settings.defaultOwner || undefined,
          description: description.trim() || undefined,
          private: visibility.value,
          autoInit: true,
        });
        deps.providers.repos.refresh();
        const action = await vscode.window.showInformationMessage(
          `已创建仓库 ${created.full_name}`,
          '在浏览器打开',
          '克隆到工作区',
        );
        if (action === '在浏览器打开') {
          await vscode.env.openExternal(vscode.Uri.parse(created.html_url));
        } else if (action === '克隆到工作区') {
          await vscode.commands.executeCommand('git.clone', created.clone_url ?? created.html_url);
        }
      } catch (error) {
        logError('创建仓库失败', error);
        void vscode.window.showErrorMessage(`创建仓库失败：${describeError(error)}`);
      }
      void context;
    },

    /** 新建分支。 */
    'gitea.createBranch': async (node) => {
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

      const from = await pickBranch(service, ref, {
        title: '选择源分支',
        default: defaultBranch,
      });
      if (!from) {
        return;
      }

      const newBranch = await vscode.window.showInputBox({
        title: '新建分支',
        prompt: `基于 ${from} 创建`,
        ignoreFocusOut: true,
        validateInput: (value) =>
          BRANCH_NAME_PATTERN.test(value.trim()) ? undefined : '分支名包含非法字符',
      });
      if (!newBranch) {
        return;
      }

      try {
        const branch = await operations.repos.createBranch(ref.owner, ref.repo, newBranch.trim(), from);
        deps.providers.repos.refresh();
        void vscode.window.showInformationMessage(
          `已创建分支 ${branch.name}（${branch.commit?.id.slice(0, 8) ?? '-'}）`,
        );
      } catch (error) {
        logError('创建分支失败', error);
        void vscode.window.showErrorMessage(`创建分支失败：${describeError(error)}`);
      }
    },
  };
}
