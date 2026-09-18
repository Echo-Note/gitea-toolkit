/**
 * 认证与诊断类命令。
 */
import * as vscode from 'vscode';
import { describeError } from '../../core/errors';
import { VERIFIED_GITEA_VERSION } from '../../core/version';
import { describeCompatibility, verifyCompatibility } from '../compatibility';
import { clearToken, readSettings, setToken } from '../config';
import { logError, logInfo, showLog } from '../logger';
import type { CommandDeps, CommandMap } from './types';

/**
 * 创建认证与诊断命令。
 * @param deps 命令依赖
 * @returns 命令映射
 */
export function createAuthCommands(deps: CommandDeps): CommandMap {
  const { context, service } = deps;

  return {
    /**
     * 设置访问令牌。先确保实例地址已配置，再校验令牌有效性。
     */
    'gitea.setToken': async () => {
      const settings = readSettings();
      if (settings.serverUrl.length === 0) {
        const url = await vscode.window.showInputBox({
          title: 'Gitea 实例地址',
          prompt: '例如 https://gitea.example.com',
          placeHolder: 'https://gitea.example.com',
          ignoreFocusOut: true,
          validateInput: (value) =>
            /^https?:\/\/.+/i.test(value.trim()) ? undefined : '请输入以 http:// 或 https:// 开头的完整地址',
        });
        if (!url) {
          return;
        }
        await vscode.workspace
          .getConfiguration('gitea')
          .update('serverUrl', url.trim().replace(/\/+$/, ''), vscode.ConfigurationTarget.Global);
      }

      const token = await vscode.window.showInputBox({
        title: 'Gitea 访问令牌',
        prompt: '在 Gitea「设置 → 应用 → 生成令牌」创建，需包含 repo / issue / notification 权限',
        placeHolder: '粘贴访问令牌',
        password: true,
        ignoreFocusOut: true,
      });
      if (!token || token.trim().length === 0) {
        return;
      }

      await setToken(context, token.trim());
      // 令牌已确认落盘，在此显式刷新视图。
      // 不依赖 secrets.onDidChange 触发：该事件的时序不确定，可能在密钥可读之前派发，
      // 导致视图渲染成「尚未设置访问令牌」，必须手动刷新才恢复。
      service.notifyChanged();
      try {
        const user = await service.getCurrentUser(true);
        logInfo(`令牌校验通过，当前用户 ${user.login}`);

        // 登录成功后立即校验服务端版本。使用 force 保证每次登录都重新核对，
        // 不沿用「该版本已提示过」的记录——用户刚换实例/刚升级时最需要知道版本是否匹配。
        const compatibility = await verifyCompatibility(context, service, { force: true });
        const suffix = compatibility ? `\n${describeCompatibility(compatibility)}` : '';
        void vscode.window.showInformationMessage(`已连接到 Gitea，当前用户：${user.login}${suffix}`);
      } catch (error) {
        logError('令牌校验失败', error);
        const action = await vscode.window.showErrorMessage(
          `访问令牌校验失败：${describeError(error)}`,
          '重新输入',
          '清除令牌',
        );
        if (action === '重新输入') {
          await vscode.commands.executeCommand('gitea.setToken');
        } else if (action === '清除令牌') {
          await vscode.commands.executeCommand('gitea.clearToken');
        }
      }
    },

    /** 清除已保存的访问令牌。 */
    'gitea.clearToken': async () => {
      const confirmed = await vscode.window.showWarningMessage(
        '确定要清除已保存的 Gitea 访问令牌吗？',
        { modal: true },
        '清除',
      );
      if (confirmed !== '清除') {
        return;
      }
      await clearToken(context);
      service.notifyChanged();
      logInfo('已清除访问令牌');
      void vscode.window.showInformationMessage('已清除 Gitea 访问令牌。');
    },

    /** 显示当前登录用户与版本信息。 */
    'gitea.showCurrentUser': async () => {
      try {
        const user = await service.getCurrentUser(true);
        const settings = readSettings();
        const version = await service.getGiteaVersion(true).catch((error) => {
          logError('读取 Gitea 版本失败', error);
          return undefined;
        });
        const detail = [
          `用户：${user.login}${user.full_name ? `（${user.full_name}）` : ''}`,
          `实例：${settings.serverUrl}`,
          `服务端版本：${version ? `Gitea ${version.version}` : '未知'}`,
          `扩展已核对版本：Gitea ${VERIFIED_GITEA_VERSION}`,
          `管理员：${user.is_admin ? '是' : '否'}`,
          `邮箱：${user.email ?? '-'}`,
        ].join('\n');
        const action = await vscode.window.showInformationMessage(detail, { modal: true }, '重新检查兼容性');
        if (action === '重新检查兼容性') {
          await verifyCompatibility(context, service, { force: true, actualVersion: version?.version });
        }
      } catch (error) {
        void vscode.window.showErrorMessage(`获取当前用户失败：${describeError(error)}`);
      }
    },

    /** 手动重新检查服务端版本兼容性。 */
    'gitea.checkCompatibility': async () => {
      const result = await verifyCompatibility(context, service, { force: true });
      if (!result) {
        void vscode.window.showWarningMessage(
          '无法获取 Gitea 版本，请先确认实例地址（gitea.serverUrl）与访问令牌是否正确。',
        );
        return;
      }
      if (!result.shouldWarn) {
        void vscode.window.showInformationMessage(describeCompatibility(result));
      }
    },

    /** 显示输出日志。 */
    'gitea.showOutput': () => {
      showLog();
    },

    /** 刷新所有视图。 */
    'gitea.refresh': async () => {
      // 与自动刷新共用 service.notifyChanged() 同一路径：
      // 两者走同一段代码，才不会出现「手动有效、自动无效」这类行为分叉。
      service.notifyChanged();
    },
  };
}
