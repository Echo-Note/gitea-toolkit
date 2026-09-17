/**
 * AI 工具目录（单一事实来源）。
 *
 * 新增能力只需在对应域文件中追加一条 {@link defineTool} 定义，
 * 随后 `npm run sync:tools` 会把 JSON Schema 同步进 package.json，
 * 扩展侧的 `vscode.lm.registerTool` 与 MCP Server 会自动生效。
 */
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { accountTools } from './accountTools';
import { issueTools } from './issueTools';
import { pullTools } from './pullTools';
import { repoTools } from './repoTools';
import type { GiteaToolDefinition } from './types';

export * from './types';
export { accountTools } from './accountTools';
export { issueTools } from './issueTools';
export { pullTools } from './pullTools';
export { repoTools } from './repoTools';

/** 全部工具定义。 */
export const TOOL_CATALOG: GiteaToolDefinition[] = [
  ...repoTools,
  ...issueTools,
  ...pullTools,
  ...accountTools,
];

/** 工具名前缀。 */
export const TOOL_PREFIX = 'gitea_';

/**
 * 按名称查找工具。
 * @param name 工具名
 * @returns 工具定义；不存在时返回 undefined
 */
export function findTool(name: string): GiteaToolDefinition | undefined {
  return TOOL_CATALOG.find((tool) => tool.name === name);
}

/**
 * 生成 VS Code 的 `languageModelTools` 清单条目。
 * @returns 可直接写入 package.json 的数组
 */
export function buildLanguageModelToolManifest(): Array<Record<string, unknown>> {
  return TOOL_CATALOG.map((tool) => ({
    name: `giteaToolkit.${tool.name}`,
    displayName: tool.displayName,
    modelDescription: tool.description,
    userDescription: tool.userDescription,
    toolReferenceName: tool.name,
    canBeReferencedInPrompt: true,
    tags: ['gitea', tool.category],
    icon: '$(gitea)',
    inputSchema: buildInputJsonSchema(tool),
  }));
}

/**
 * 生成单个工具的 JSON Schema（内联，无 `$ref`，符合 VS Code 清单要求）。
 * @param tool 工具定义
 * @returns JSON Schema 对象
 */
export function buildInputJsonSchema(tool: GiteaToolDefinition): Record<string, unknown> {
  if (Object.keys(tool.inputShape).length === 0) {
    return { type: 'object', properties: {} };
  }
  const schema = zodToJsonSchema(z.object(tool.inputShape), {
    $refStrategy: 'none',
    target: 'jsonSchema7',
  }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}
