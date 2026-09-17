/**
 * 语言模型工具注册（`vscode.lm.registerTool`）。
 *
 * 与 MCP 路径的区别：
 *   - MCP 走独立子进程、面向所有 MCP 客户端
 *   - 语言模型工具常驻扩展宿主，延迟更低，且能直接使用工作区上下文（git 远端、已保存令牌）
 * 两者共用同一份 {@link TOOL_CATALOG}，因此能力完全一致。
 *
 * 注意：工具名必须与 package.json `contributes.languageModelTools[].name` 一致，
 * 该清单由 `npm run sync:tools` 依据工具目录自动生成。
 */
import * as vscode from 'vscode';
import { describeError } from '../core/errors';
import { TOOL_CATALOG, type GiteaToolDefinition, type GiteaToolContext } from './tools/index';
import { logError, logInfo, logWarn } from '../vscode/logger';
import type { GiteaService } from '../vscode/service';

/** 工具名前缀，与清单生成逻辑保持一致。 */
export const TOOL_NAME_PREFIX = 'giteaToolkit.';

/**
 * 注册全部语言模型工具。
 * @param context 扩展上下文
 * @param service Gitea 服务
 */
export function registerLanguageModelTools(context: vscode.ExtensionContext, service: GiteaService): void {
  if (typeof vscode.lm?.registerTool !== 'function') {
    logWarn('当前编辑器不支持 vscode.lm.registerTool，AI 工具将仅通过 MCP 暴露');
    return;
  }

  for (const tool of TOOL_CATALOG) {
    const fullName = `${TOOL_NAME_PREFIX}${tool.name}`;
    const registration = vscode.lm.registerTool<Record<string, unknown>>(fullName, {
      invoke: async (options) => invokeTool(tool, options.input ?? {}, service),
      prepareInvocation: async (options) => prepareInvocation(tool, options.input ?? {}),
    });
    context.subscriptions.push(registration);
  }
  logInfo(`已注册 ${TOOL_CATALOG.length} 个语言模型工具`);
}

/**
 * 执行工具并封装为 VS Code 结果对象。
 * @param tool 工具定义
 * @param input 入参
 * @param service Gitea 服务
 * @returns 工具结果
 */
async function invokeTool(
  tool: GiteaToolDefinition,
  input: Record<string, unknown>,
  service: GiteaService,
): Promise<vscode.LanguageModelToolResult> {
  try {
    const context: GiteaToolContext = await service.createToolContext();
    const result = await tool.handler(input, context);
    const parts: Array<vscode.LanguageModelTextPart | vscode.LanguageModelDataPart> = [
      new vscode.LanguageModelTextPart(result.text),
    ];
    if (result.data !== undefined) {
      parts.push(vscode.LanguageModelDataPart.json(result.data));
    }
    return new vscode.LanguageModelToolResult(parts);
  } catch (error) {
    logError(`语言模型工具 ${tool.name} 执行失败`, error);
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(`调用失败：${describeError(error)}`),
    ]);
  }
}

/**
 * 构造调用前的提示与确认信息。写操作强制用户确认，避免 AI 误改线上数据。
 * @param tool 工具定义
 * @param input 入参
 * @returns 调用准备信息
 */
function prepareInvocation(
  tool: GiteaToolDefinition,
  input: Record<string, unknown>,
): vscode.PreparedToolInvocation {
  const invocationMessage = `正在执行 Gitea 操作：${tool.displayName}`;
  if (tool.access === 'read') {
    return { invocationMessage };
  }
  const detail = Object.keys(input).length > 0 ? `\n\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\`` : '';
  return {
    invocationMessage,
    confirmationMessages: {
      title: `确认执行「${tool.displayName}」？`,
      message: new vscode.MarkdownString(`${tool.userDescription}${detail}`),
    },
  };
}
