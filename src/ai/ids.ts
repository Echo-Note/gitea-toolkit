/**
 * 面向编辑器的标识符，**集中定义处**。
 *
 * 单独成模块、且**不依赖 vscode**，是为了让 `scripts/sync-tools.mjs` 能直接加载它们，
 * 与 package.json 里的清单逐项比对。
 *
 * 为什么值得单独抽出来：这两类 ID 此前都在「package.json 的清单」与「注册代码」里
 * 各写了一遍，靠注释约定保持同步。2026-09-18 的 `giteaToolkit.` 事故就是这样漏出去的 ——
 * 工具 ID 含点号，`vscode.lm.registerTool` 逐个拒绝注册（27 个全挂），
 * 而 package.json、类型检查、Lint 全都没能发现。
 */

/**
 * 语言模型工具 ID 的前缀。
 *
 * 硬约束：`vscode.lm.registerTool` 的 ID 与 `contributes.languageModelTools[].name`
 * 都必须匹配 `/^[\w-]+$/` —— **不允许点号**。
 */
export const LANGUAGE_MODEL_TOOL_PREFIX = 'giteaToolkit_';

/**
 * MCP Server 定义提供者的 ID。
 *
 * 必须与 `package.json` 的 `contributes.mcpServerDefinitionProviders[].id` 一致
 * （VS Code 文档原文："This id should match the one used in the implementation"）。
 *
 * 同样不使用点号：官方文档示例是 `"exampleProvider"` 这种裸标识符，未示范点分格式，
 * 也未公开字符集规则 —— 不做未经证实的假设。
 */
export const MCP_PROVIDER_ID = 'giteaToolkit_mcp';
