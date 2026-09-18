/**
 * Gitea Actions 相关的编辑器命令。
 *
 * 与 AI 工具的分工：这里处理「用户在侧边栏点/右键」的交互，
 * 业务语义仍走同一套 {@link GiteaOperations}.actions，保证两条路径行为一致。
 */
import * as vscode from 'vscode';
import { describeError } from '../../core/errors';
import { logError } from '../logger';
import type { GiteaNode } from '../views/nodes';
import type { CommandDeps, CommandMap } from './types';

/** 从树节点里取负载（命令回调收到的是 unknown）。 */
function payloadOf(node: unknown): Record<string, unknown> {
  return ((node as GiteaNode | undefined)?.payload ?? {}) as Record<string, unknown>;
}

/** 取出必需的字符串字段。 */
function str(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

/** 取出必需的数字字段。 */
function num(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  return typeof value === 'number' ? value : 0;
}

/**
 * 创建 Actions 命令。
 * @param deps 命令依赖
 * @returns 命令映射
 */
export function createActionCommands(deps: CommandDeps): CommandMap {
  const { service, providers } = deps;

  return {
    /**
     * 在编辑器里查看作业日志。
     *
     * 之所以不用 OutputChannel：日志需要能搜索、能复制、能并排对比，
     * 以「未保存的只读文档」呈现最自然（也便于用户另存）。
     */
    'gitea.showJobLogs': async (node) => {
      const payload = payloadOf(node);
      const owner = str(payload, 'owner');
      const repo = str(payload, 'repo');
      const jobId = num(payload, 'jobId');
      const name = str(payload, 'name') || `job ${jobId}`;
      if (!owner || !repo || !jobId) {
        void vscode.window.showWarningMessage('该节点缺少作业信息，请刷新视图后重试。');
        return;
      }
      const operations = await service.getOperations();
      const logs = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `正在获取「${name}」的日志…` },
        () => operations.actions.getJobLogs(owner, repo, jobId),
      );
      const content =
        logs.trim().length > 0 ? logs : '（该作业没有日志：可能仍在排队，或日志已被清理。）';
      // 未保存文档：不落盘、不需要工作区，纯查看用途
      const document = await vscode.workspace.openTextDocument({ content, language: 'plaintext' });
      await vscode.window.showTextDocument(document, { preview: false });
    },

    /** 重跑一次运行：整条或仅失败的作业。 */
    'gitea.rerunAction': async (node) => {
      const payload = payloadOf(node);
      const owner = str(payload, 'owner');
      const repo = str(payload, 'repo');
      const runId = num(payload, 'runId');
      if (!owner || !repo || !runId) {
        void vscode.window.showWarningMessage('该节点缺少运行信息，请刷新视图后重试。');
        return;
      }
      const picked = await vscode.window.showQuickPick(
        [
          { label: '仅重跑失败的作业', failedOnly: true },
          { label: '整条重跑', failedOnly: false },
        ],
        { title: `重跑 ${owner}/${repo} 运行 ${runId}`, placeHolder: '选择重跑范围' },
      );
      if (!picked) {
        return;
      }
      try {
        const operations = await service.getOperations();
        if (picked.failedOnly) {
          await operations.actions.rerunFailedJobs(owner, repo, runId);
        } else {
          await operations.actions.rerunRun(owner, repo, runId);
        }
        void vscode.window.showInformationMessage(
          `已提交重跑请求（${picked.failedOnly ? '仅失败作业' : '整条运行'}）。`,
        );
        // 稍后刷新，给服务端一点时间把新状态写出来
        setTimeout(() => providers.repos.refresh(), 1500);
      } catch (error) {
        logError('重跑 Actions 失败', error);
        void vscode.window.showErrorMessage(`重跑失败：${describeError(error)}`);
      }
    },

    /** 手动触发工作流（`workflow_dispatch`）。 */
    'gitea.triggerWorkflow': async (node) => {
      const payload = payloadOf(node);
      const owner = str(payload, 'owner');
      const repo = str(payload, 'repo');
      const workflowId = str(payload, 'workflowId');
      if (!owner || !repo || !workflowId) {
        void vscode.window.showWarningMessage('该节点缺少工作流信息，请刷新视图后重试。');
        return;
      }
      try {
        const operations = await service.getOperations();
        // 用仓库默认分支作为默认值，覆盖大多数「手动跑一次」的场景
        const detail = await operations.repos.get(owner, repo);
        const ref = await vscode.window.showInputBox({
          title: `触发 ${workflowId}`,
          prompt: '目标引用：分支名、标签名或提交 SHA',
          value: detail.default_branch,
          ignoreFocusOut: true,
        });
        if (!ref) {
          return;
        }
        await operations.actions.dispatchWorkflow({ owner, repo, workflowId, ref });
        void vscode.window.showInformationMessage(
          `已触发 \`${workflowId}\`（ref \`${ref}\`）。运行需要一点时间才会出现在列表里。`,
        );
        setTimeout(() => providers.repos.refresh(), 3000);
      } catch (error) {
        logError('触发 Actions 工作流失败', error);
        void vscode.window.showErrorMessage(
          `触发失败：${describeError(error)}\n\n只有声明了 \`on: workflow_dispatch\` 的工作流才能被手动触发。`,
        );
      }
    },
  };
}
