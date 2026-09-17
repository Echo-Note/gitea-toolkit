/**
 * 核心层统一出口。
 *
 * 该目录下的代码不依赖 `vscode` 模块，因此可同时被：
 *   1. VS Code 扩展宿主（dist/extension.js）
 *   2. 内置 MCP Server 子进程（dist/mcpServer.js）
 * 复用，避免同一套 Gitea 语义出现两份实现。
 */
import { GiteaClient, type GiteaClientOptions } from './giteaClient';
import { GiteaOperations } from './operations';

export * from './encoding';
export * from './errors';
export * from './giteaClient';
export * from './operations';
export * from './repoRef';
export * from './types';
export * from './urls';
export * from './version';

/**
 * 一次性构造客户端与操作集合。
 * @param options 客户端参数
 * @returns 客户端与聚合操作
 */
export function createGitea(
  options: GiteaClientOptions,
): { client: GiteaClient; operations: GiteaOperations } {
  const client = new GiteaClient(options);
  return { client, operations: new GiteaOperations(client) };
}
