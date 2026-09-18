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

/** 作业日志的输出通道（懒创建，整个会话复用同一个）。 */
let jobLogChannel: vscode.OutputChannel | undefined;

/**
 * 取得作业日志的输出通道。
 * @param context 扩展上下文（用于登记销毁）
 * @returns 输出通道
 */
function getJobLogChannel(context: vscode.ExtensionContext): vscode.OutputChannel {
  if (!jobLogChannel) {
    jobLogChannel = vscode.window.createOutputChannel('Gitea 工作流日志');
    context.subscriptions.push(jobLogChannel);
  }
  return jobLogChannel;
}

/**
 * 创建工作流相关命令。
 * @param deps 命令依赖
 * @returns 命令映射
 */
export function createActionCommands(deps: CommandDeps): CommandMap {
  const { service, providers, context } = deps;

  return {
    /**
     * 在**输出面板**里查看作业日志。
     *
     * 为什么不用编辑器文档：原先用 `openTextDocument({content})`，会生成一个**未保存的
     * 临时文档** —— 标题是 `Untitled-1`、关闭时还要问要不要保存，既占编辑器标签，
     * 也和「Issue / PR 走详情面板」的体验不一致，用户明确反馈过这一点。
     *
     * 日志本来就是「输出」类内容，放进输出面板更自然：不占编辑器、不会被误改、
     * 随时用同一条命令就能切回来。
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
      const channel = getJobLogChannel(context);
      // 每次清空：既避免长时间使用后无限增长，也保证重复点击同一个作业时看到的是它自己
      channel.clear();
      channel.appendLine(`# ${owner}/${repo} · ${name}（job ${jobId}）`);
      channel.appendLine('');
      const hasLogs = logs.trim().length > 0;
      channel.appendLine(
        hasLogs
          ? logs
          : '（该作业没有可用的日志。常见原因：运行被取消、作业尚未开始执行，' +
              '或服务端已清理日志 —— Gitea 会对日志做保留期清理。）',
      );
      // 用 show() 而不是 show(true)：这里必须确保输出面板真的被打开并切到本通道，
      // 让出焦点是次要的。
      channel.show();
      // 日志为空时额外给一条提示：否则面板里只有一行标题，看起来像「什么都没发生」。
      // 实测镜像仓库的旧运行多半属于「日志已被 Gitea 清理」，这条提示能直接说明原因。
      if (!hasLogs) {
        void vscode.window.showInformationMessage(
          `「${name}」没有可用的日志：运行可能已取消，或服务端已清理（Gitea 有保留期）。`,
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
