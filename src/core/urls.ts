/**
 * Gitea 网页地址构造。
 *
 * 为什么需要这个模块：并非所有实体的 API 响应都带 `html_url`——
 * 例如 `GET /repos/{owner}/{repo}/branches` 返回的 `Branch` 结构里就没有，
 * 必须按 Gitea 的路由规则自行拼接。集中在此处便于核对与复用，
 * 也避免各处拼字符串拼错（例如分支名含 `/` 时的编码）。
 */

/**
 * 规范化实例地址（去掉结尾斜杠）。
 * @param serverUrl 实例地址
 * @returns 规范化后的地址
 */
function base(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, '');
}

/**
 * 对引用名（分支 / 标签）编码。
 * 保留 `/` 分隔符——Gitea 支持 `feature/foo` 这类多级分支名。
 * @param ref 引用名
 * @returns 已编码的引用名
 */
function encodeRef(ref: string): string {
  return ref
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/**
 * 仓库首页地址。
 * @param serverUrl 实例地址
 * @param owner 所属者
 * @param repo 仓库名
 * @returns 网页地址
 */
export function repoWebUrl(serverUrl: string, owner: string, repo: string): string {
  return `${base(serverUrl)}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

/**
 * 分支的文件浏览页地址。
 *
 * 已对实例验证：`/{owner}/{repo}/src/branch/{branch}` 直接返回 200；
 * 旧格式 `/{owner}/{repo}/src/{branch}` 会 303 跳转，因此采用前者。
 * @param serverUrl 实例地址
 * @param owner 所属者
 * @param repo 仓库名
 * @param branch 分支名
 * @returns 网页地址
 */
export function branchWebUrl(serverUrl: string, owner: string, repo: string, branch: string): string {
  return `${repoWebUrl(serverUrl, owner, repo)}/src/branch/${encodeRef(branch)}`;
}

/**
 * Issue 详情页地址。
 * @param serverUrl 实例地址
 * @param owner 所属者
 * @param repo 仓库名
 * @param index Issue 序号
 * @returns 网页地址
 */
export function issueWebUrl(serverUrl: string, owner: string, repo: string, index: number): string {
  return `${repoWebUrl(serverUrl, owner, repo)}/issues/${index}`;
}

/**
 * Pull Request 详情页地址。
 * @param serverUrl 实例地址
 * @param owner 所属者
 * @param repo 仓库名
 * @param index PR 序号
 * @returns 网页地址
 */
export function pullWebUrl(serverUrl: string, owner: string, repo: string, index: number): string {
  return `${repoWebUrl(serverUrl, owner, repo)}/pulls/${index}`;
}

/**
 * 工作流运行详情页地址。
 *
 * 运行记录 API 响应里带 `html_url`，但触发（dispatch）后拿到的编号未必齐全，
 * 统一走这里自拼，避免两处逻辑不一致。
 * @param serverUrl 实例地址
 * @param owner 所属者
 * @param repo 仓库名
 * @param runNumber 运行编号（`run_number`，**不是** 内部 `id`）
 * @returns 网页地址
 */
export function runWebUrl(
  serverUrl: string,
  owner: string,
  repo: string,
  runNumber: number,
): string {
  return `${repoWebUrl(serverUrl, owner, repo)}/actions/runs/${runNumber}`;
}

/**
 * 工作流详情页地址。
 * @param serverUrl 实例地址
 * @param owner 所属者
 * @param repo 仓库名
 * @param workflowId 工作流文件名，如 `ci.yml`
 * @returns 网页地址
 */
export function workflowWebUrl(
  serverUrl: string,
  owner: string,
  repo: string,
  workflowId: string,
): string {
  return `${repoWebUrl(serverUrl, owner, repo)}/actions/workflows/${encodeURIComponent(workflowId)}`;
}
