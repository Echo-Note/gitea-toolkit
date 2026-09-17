/**
 * Git 远端地址 ↔ Gitea 仓库坐标 的解析工具。
 *
 * 作用：当 AI 工具未显式给出 `owner` / `repo` 时，从当前工作区的 `origin` 远端推断，
 * 从而让「在 Gitea 仓库里问 AI」这类高频场景无需重复传参。
 */

/** 仓库坐标。 */
export interface RepoRef {
  owner: string;
  repo: string;
}

/**
 * 判断远端地址是否指向指定 Gitea 实例，并解析出 {owner, repo}。
 * 支持 SSH（`git@host:owner/repo.git`）与 HTTP(S)（`https://host/owner/repo.git`）两种形式。
 * @param remoteUrl git 远端地址
 * @param serverUrl 已配置的 Gitea 实例地址
 * @returns 解析出的仓库坐标；不匹配时返回 undefined
 */
export function parseGiteaRemote(remoteUrl: string, serverUrl: string): RepoRef | undefined {
  const remote = remoteUrl.trim();
  if (remote.length === 0) {
    return undefined;
  }

  const server = parseServerHost(serverUrl);
  if (!server) {
    return undefined;
  }

  const sshMatch = /^(?:ssh:\/\/)?(?:[^@/]+@)?([^:/]+)(?::(\d+))?[/:](.+?)(?:\.git)?\/?$/.exec(remote);
  if (sshMatch && !/^https?:\/\//i.test(remote)) {
    const [, host, port, path] = sshMatch;
    if (!isSameHost(host, port, server)) {
      return undefined;
    }
    return splitOwnerRepo(path);
  }

  try {
    const url = new URL(remote);
    if (!isSameHost(url.hostname, url.port || undefined, server)) {
      return undefined;
    }
    return splitOwnerRepo(url.pathname.replace(/^\/+/, ''));
  } catch {
    return undefined;
  }
}

/**
 * 从 `owner/repo` 形式（可带多层前缀）中取出最后两段作为仓库坐标。
 * @param path 路径部分
 * @returns 仓库坐标；段数不足时返回 undefined
 */
function splitOwnerRepo(path: string): RepoRef | undefined {
  const segments = path
    .replace(/\.git$/i, '')
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length < 2) {
    return undefined;
  }
  return {
    owner: segments[segments.length - 2],
    repo: segments[segments.length - 1],
  };
}

/** 已解析的实例信息。 */
interface ServerHost {
  hostname: string;
  port?: string;
}

/**
 * 解析实例地址中的主机与端口。
 * @param serverUrl 实例地址
 * @returns 主机信息；非法地址返回 undefined
 */
function parseServerHost(serverUrl: string): ServerHost | undefined {
  try {
    const url = new URL(serverUrl);
    return { hostname: url.hostname.toLowerCase(), port: url.port || undefined };
  } catch {
    return undefined;
  }
}

/**
 * 比较两个主机是否指向同一实例（忽略默认端口差异）。
 * @param hostname 待比较主机名
 * @param port 待比较端口
 * @param server 目标实例
 * @returns 是否一致
 */
function isSameHost(hostname: string, port: string | undefined, server: ServerHost): boolean {
  if (hostname.toLowerCase() !== server.hostname) {
    return false;
  }
  const normalize = (value: string | undefined): string =>
    value === undefined || value === '' || value === '22' || value === '80' || value === '443' ? '' : value;
  return normalize(port) === normalize(server.port);
}
