/**
 * MCP Server 侧的默认仓库解析：通过调用 git 读取当前目录的 origin 远端。
 *
 * MCP Server 以子进程方式运行，拿不到 VS Code 的 Git 扩展 API，
 * 因此这里直接调用 git 命令；解析逻辑与扩展侧共用 {@link parseGiteaRemote}。
 */
import { execFile } from 'node:child_process';
import { parseGiteaRemote, type RepoRef } from '../core/repoRef';

/**
 * 读取指定目录下 origin 远端地址。
 * @param cwd 工作目录
 * @returns 远端地址；失败时返回 undefined
 */
function readOriginUrl(cwd: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('git', ['remote', 'get-url', 'origin'], { cwd, timeout: 5_000 }, (error, stdout) => {
      if (error) {
        resolve(undefined);
        return;
      }
      const url = stdout.trim();
      resolve(url.length > 0 ? url : undefined);
    });
  });
}

/**
 * 从工作目录推断 Gitea 仓库坐标。
 * @param cwd 工作目录
 * @param serverUrl Gitea 实例地址
 * @returns 仓库坐标；无法推断时返回 undefined
 */
export async function resolveDefaultRepo(cwd: string, serverUrl: string): Promise<RepoRef | undefined> {
  const url = await readOriginUrl(cwd);
  if (!url) {
    return undefined;
  }
  return parseGiteaRemote(url, serverUrl);
}
