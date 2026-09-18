/**
 * Gitea Actions 相关的编辑器命令。
 *
 * 与 AI 工具的分工：这里处理「用户在侧边栏点/右键」的交互，
 * 业务语义仍走同一套 {@link GiteaOperations}.actions，保证两条路径行为一致。
 */
import * as vscode from 'vscode';
import { describeError } from '../../core/errors';
import { logError } from '../logger';
import { openReadonlyDocument, safeFileName } from '../readonlyDocument';
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
 * 创建工作流相关命令。
 * @param deps 命令依赖
 * @returns 命令映射
 */
export function createActionCommands(deps: CommandDeps): CommandMap {
  const { service, providers } = deps;

  return {
    /**
     * 在**主窗口的只读标签**里查看作业日志。
     *
     * 这个位置换过两次：最初是 `openTextDocument({content})` 生成的未保存文档
     * （占标签、关闭时要问是否保存），后来改成输出面板（不占标签，但没有查找/替换、
     * 不能并排对比）。现在用只读虚拟文档 —— **既在主窗口、又由平台保证只读**，
     * 编辑器该有的查找/对比/复制全都可用。
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
      const hasLogs = logs.trim().length > 0;
      const content = hasLogs
        ? logs
        : [
            '（该作业没有可用的日志。）',
            '',
            '常见原因：',
            '  · 运行被取消，或作业尚未开始执行',
            '  · 服务端已清理日志 —— Gitea 会对作业日志做保留期清理，旧运行查不到',
            '',
          ].join('\n');
      // 路径最后一段决定标签标题；前面几段（仓库、作业 ID）会出现在悬停提示里，
      // 用来区分同名的作业
      const document = await openReadonlyDocument(
        [owner, repo, 'job', String(jobId), `${safeFileName(name)}.log`],
        content,
      );
      await vscode.window.showTextDocument(document, { preview: false });
      if (!hasLogs) {
        // 空内容时额外说一句：否则标签里只有一段说明，容易被当成「什么都没发生」
        void vscode.window.showInformationMessage(
          `「${name}」没有可用的日志：运行可能已取消，或服务端已清理（Gitea 有保留期）。`,
        );
      }
    },

    /**
     * 在只读标签里查看工作流定义（YAML 原文）。
     *
     * 为什么把「在浏览器打开」从左键默认动作换掉：用户点一条 `ci.yml` 时，
     * 最想知道的是「这个工作流是什么」，跳浏览器既慢又离开了当前上下文。
     * 浏览器入口保留在右键菜单里（`gitea.openInBrowser`）。
     */
    'gitea.showWorkflow': async (node) => {
      const payload = payloadOf(node);
      const owner = str(payload, 'owner');
      const repo = str(payload, 'repo');
      const workflowId = str(payload, 'workflowId');
      const name = str(payload, 'name') || workflowId;
      if (!owner || !repo || !workflowId) {
        void vscode.window.showWarningMessage('该节点缺少工作流信息，请刷新视图后重试。');
        return;
      }
      try {
        const operations = await service.getOperations();
        const file = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `正在获取「${name}」…` },
          () => operations.repos.getFileContent(owner, repo, workflowId),
        );
        const body = file.truncated
          ? `${file.content}\n\n…（文件较大已截断，完整内容请在浏览器中打开）\n`
          : file.content;
        const fileName = safeFileName(workflowId.split('/').pop() ?? workflowId);
        const document = await openReadonlyDocument(
          [owner, repo, 'workflow', fileName],
          body,
          // 明确指定语言：自定义 scheme 不保证能按扩展名推断出 YAML
          /\.ya?ml$/i.test(fileName) ? 'yaml' : undefined,
        );
        await vscode.window.showTextDocument(document, { preview: false });
      } catch (error) {
        logError('读取工作流定义失败', error);
        void vscode.window.showErrorMessage(
          `读取工作流定义失败：${describeError(error)}\n\n` +
            '若该条目来自接口（而非文件列表），它可能没有可直接读取的文件路径 —— ' +
            '可以用右键菜单的「在浏览器打开」查看。',
        );
      }
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
        logError('重跑工作流失败', error);
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
        logError('触发工作流失败', error);
        void vscode.window.showErrorMessage(
          `触发失败：${describeError(error)}\n\n只有声明了 \`on: workflow_dispatch\` 的工作流才能被手动触发。`,
        );
      }
    },
  };
}
