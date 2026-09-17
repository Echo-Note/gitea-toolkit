/**
 * MCP 接入类命令：复制配置片段 / 写入配置文件。
 *
 * 三条路径的取舍：
 *   - VS Code：支持 `mcpServerDefinitionProviders` 动态发现，无需落盘（已在 mcpProvider 中注册）
 *   - CodeBuddy：**不消费**该贡献点，MCP 面板完全由用户级 `~/.codebuddy/mcp.json` 驱动，
 *     必须写入该文件（`gitea.writeCodeBuddyUserMcpConfig`）才会出现
 *   - 其它客户端：复制片段手动粘贴，或写入工作区级配置文件
 */
import * as vscode from 'vscode';
import { candidateConfigPaths } from '../../ai/mcpConfig';
import {
  buildCurrentMcpConfig,
  writeCodeBuddyUserMcpConfig,
  writeMcpConfig,
} from '../mcpConfigWriter';
import { logError } from '../logger';
import type { CommandDeps, CommandMap } from './types';

/**
 * 创建 MCP 接入命令。
 * @param deps 命令依赖
 * @returns 命令映射
 */
export function createMcpCommands(deps: CommandDeps): CommandMap {
  const { service, context } = deps;

  return {
    /** 复制 MCP 配置到剪贴板。 */
    'gitea.copyMcpConfig': async () => {
      const config = await buildCurrentMcpConfig(context, service);
      await vscode.env.clipboard.writeText(JSON.stringify(config, null, 2));
      const action = await vscode.window.showInformationMessage(
        '已复制 Gitea MCP 配置。粘贴到 MCP 客户端的「Add MCP」配置文件中即可。',
        '写入 CodeBuddy 配置',
        '写入工作区配置文件',
      );
      if (action === '写入 CodeBuddy 配置') {
        await vscode.commands.executeCommand('gitea.writeCodeBuddyUserMcpConfig');
      } else if (action === '写入工作区配置文件') {
        await vscode.commands.executeCommand('gitea.writeMcpConfig');
      }
    },

    /** 写入 CodeBuddy 用户级 MCP 配置（`~/.codebuddy/mcp.json`）。 */
    'gitea.writeCodeBuddyUserMcpConfig': async () => {
      try {
        const filePath = await writeCodeBuddyUserMcpConfig(context, service);
        const action = await vscode.window.showInformationMessage(
          `已写入 CodeBuddy 用户级 MCP 配置：${filePath}\n请在 CodeBuddy 的 MCP 面板刷新（或重启编辑器），会出现名为 gitea 的服务。`,
          '打开文件',
        );
        if (action === '打开文件') {
          await vscode.window.showTextDocument(vscode.Uri.file(filePath));
        }
      } catch (error) {
        logError('写入 CodeBuddy MCP 配置失败', error);
        void vscode.window.showErrorMessage(`写入 CodeBuddy MCP 配置失败：${(error as Error).message}`);
      }
    },

    /** 写入 MCP 配置文件到工作区。 */
    'gitea.writeMcpConfig': async () => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) {
        void vscode.window.showWarningMessage('请先打开一个工作区目录。');
        return;
      }

      const picked = await vscode.window.showQuickPick(
        candidateConfigPaths().map((relative) => ({
          label: relative,
          description: relative.startsWith('.codebuddy')
            ? 'CodeBuddy 项目级配置'
            : relative.startsWith('.vscode')
              ? 'VS Code 工作区配置'
              : '通用 MCP 配置',
          relative,
        })),
        { title: '选择要写入的 MCP 配置文件', placeHolder: '文件不存在时会自动创建' },
      );
      if (!picked) {
        return;
      }

      try {
        const config = await buildCurrentMcpConfig(context, service);
        const targetUri = await writeMcpConfig(folders[0].uri, picked.relative, config);
        const action = await vscode.window.showInformationMessage(
          `已写入 ${picked.relative}。请在 MCP 客户端中启用「gitea」服务（部分客户端需重启或重新加载）。`,
          '打开文件',
        );
        if (action === '打开文件') {
          await vscode.window.showTextDocument(targetUri);
        }
      } catch (error) {
        logError('写入 MCP 配置失败', error);
        void vscode.window.showErrorMessage(`写入 MCP 配置失败：${(error as Error).message}`);
      }
    },
  };
}
