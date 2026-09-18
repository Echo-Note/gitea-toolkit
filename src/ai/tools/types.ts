/**
 * AI 工具的类型契约。
 *
 * 工具目录是「单一事实来源」：同一份定义同时产出
 *   - package.json 的 `contributes.languageModelTools`（JSON Schema）
 *   - `vscode.lm.registerTool` 的运行时处理器
 *   - 内置 MCP Server 的 tool 列表
 * 因此新增一个能力只需要在这里加一条定义，无需三处同步。
 */
import type { ZodRawShape, z } from 'zod';
import type { GiteaOperations } from '../../core/operations';

/** 工具返回结果。 */
export interface GiteaToolResult {
  /** 返回给模型 / 用户的 Markdown 文本。 */
  text: string;
  /** 结构化数据；MCP 侧作为 structuredContent 返回，便于客户端渲染。 */
  data?: unknown;
}

/** 工具执行上下文。 */
export interface GiteaToolContext {
  /** Gitea 操作集合。 */
  operations: GiteaOperations;
  /** 已连接的 Gitea 实例地址（用于向模型交代「在跟哪个实例说话」）。 */
  serverUrl: string;
  /** 当前工作区解析出的默认仓库（来自 git origin 远端）。 */
  defaultRepo?: { owner: string; repo: string };
  /** 在系统浏览器打开链接（仅扩展宿主可用）。 */
  openExternal?: (url: string) => Promise<void>;
}

/** 工具分类。 */
export type GiteaToolCategory = 'repository' | 'issue' | 'pull' | 'account' | 'action';

/** 只读 / 读写标记。 */
export type GiteaToolAccess = 'read' | 'write';

/** 工具定义（已擦除具体入参类型的运行时形态）。 */
export interface GiteaToolDefinition {
  /** 工具名，snake_case，全局唯一。 */
  name: string;
  /** 展示名（中文）。 */
  displayName: string;
  /** 提供给模型的详细描述。 */
  description: string;
  /** 展示给用户的简短描述。 */
  userDescription: string;
  /** 分类，用于 UI 分组。 */
  category: GiteaToolCategory;
  /** 访问级别。 */
  access: GiteaToolAccess;
  /** 入参 zod 形状（单一事实来源）。 */
  inputShape: ZodRawShape;
  /** 运行时处理器。 */
  handler: (input: Record<string, unknown>, ctx: GiteaToolContext) => Promise<GiteaToolResult>;
}

/** 定义工具时的入参规范（保留泛型推导）。 */
export interface GiteaToolSpec<S extends ZodRawShape> {
  name: string;
  displayName: string;
  description: string;
  userDescription: string;
  category: GiteaToolCategory;
  access: GiteaToolAccess;
  inputShape: S;
  handler: (input: z.infer<z.ZodObject<S>>, ctx: GiteaToolContext) => Promise<GiteaToolResult>;
}

/**
 * 定义工具。提供定义处的完整类型推导，同时抹平为 {@link GiteaToolDefinition}，
 * 便于放入同一数组并动态注册。
 * @param spec 工具规范
 * @returns 运行时工具定义
 */
export function defineTool<S extends ZodRawShape>(spec: GiteaToolSpec<S>): GiteaToolDefinition {
  return {
    name: spec.name,
    displayName: spec.displayName,
    description: spec.description,
    userDescription: spec.userDescription,
    category: spec.category,
    access: spec.access,
    inputShape: spec.inputShape,
    handler: spec.handler as unknown as GiteaToolDefinition['handler'],
  };
}

/** 入参校验 / 解析失败。 */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}
