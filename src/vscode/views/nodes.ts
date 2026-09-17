/**
 * 树节点定义。
 *
 * 节点自带 `loadChildren` 闭包，实现「展开时才发请求」的懒加载，
 * 避免一次性拉取全部数据拖慢侧边栏。
 *
 * 图标统一由 {@link ./icons} 提供，本文件只负责节点结构与交互绑定。
 */
import * as vscode from 'vscode';
import { branchIcon, issueIcon, pullIcon, repoIcon, type IconSpec, type RepoIconFlags } from './icons';

/**
 * 把纯数据图标描述转换为 VS Code 主题图标。
 * @param spec 图标描述
 * @returns 主题图标
 */
export function toThemeIcon(spec: IconSpec): vscode.ThemeIcon {
  return spec.color
    ? new vscode.ThemeIcon(spec.id, new vscode.ThemeColor(spec.color))
    : new vscode.ThemeIcon(spec.id);
}

/** 节点类型，用于生成 `contextValue` 以驱动右键菜单可见性。 */
export type GiteaNodeKind = 'repo' | 'issue' | 'pull' | 'branch' | 'notification' | 'group' | 'message';

/** Issue 节点携带的数据。 */
export interface IssueNodePayload {
  owner: string;
  repo: string;
  number: number;
  state: string;
  htmlUrl?: string;
}

/** PR 节点携带的数据。 */
export interface PullNodePayload extends IssueNodePayload {
  headRef?: string;
  baseRef?: string;
  merged?: boolean;
  draft?: boolean;
}

/** 仓库节点携带的数据。 */
export interface RepoNodePayload extends RepoIconFlags {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  htmlUrl: string;
  cloneUrl?: string;
}

/** 通知节点携带的数据。 */
export interface NotificationNodePayload {
  id: number;
  title: string;
  subjectType?: string;
  repoFullName?: string;
  htmlUrl?: string;
  unread?: boolean;
}

/** 通用树节点。 */
export class GiteaNode extends vscode.TreeItem {
  /**
   * @param kind 节点类型
   * @param label 显示文本
   * @param collapsibleState 展开状态
   * @param payload 业务数据，供命令处理器读取
   * @param loadChildren 子节点加载器（懒执行）
   */
  constructor(
    public readonly kind: GiteaNodeKind,
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly payload: unknown,
    public readonly loadChildren?: () => Promise<GiteaNode[]>,
  ) {
    super(label, collapsibleState);
    this.contextValue = `gitea.${kind}`;
  }
}

/**
 * 创建仓库节点。
 * @param repo 仓库信息（含私有 / 归档 / Fork 等标记，用于区分图标）
 * @param loadChildren 子节点加载器
 * @returns 节点
 */
export function createRepoNode(repo: RepoNodePayload, loadChildren: () => Promise<GiteaNode[]>): GiteaNode {
  const node = new GiteaNode(
    'repo',
    repo.name,
    vscode.TreeItemCollapsibleState.Collapsed,
    repo,
    loadChildren,
  );
  node.description = repo.owner;
  node.tooltip = new vscode.MarkdownString(
    `**${repo.fullName}**\n\n默认分支：\`${repo.defaultBranch}\`\n\n[在浏览器中打开](${repo.htmlUrl})`,
  );
  node.resourceUri = vscode.Uri.parse(repo.htmlUrl);
  node.iconPath = toThemeIcon(repoIcon(repo));
  return node;
}

/**
 * 创建分组节点。
 * @param label 分组名
 * @param iconPath 分组图标（纯数据，内部转换）
 * @param loadChildren 子节点加载器
 * @returns 节点
 */
export function createGroupNode(
  label: string,
  iconPath: IconSpec,
  loadChildren: () => Promise<GiteaNode[]>,
): GiteaNode {
  const node = new GiteaNode('group', label, vscode.TreeItemCollapsibleState.Collapsed, undefined, loadChildren);
  node.iconPath = toThemeIcon(iconPath);
  return node;
}

/**
 * 创建 Issue 节点。
 * @param label 显示标题
 * @param payload 业务数据
 * @param description 次要说明
 * @returns 节点
 */
export function createIssueNode(label: string, payload: IssueNodePayload, description?: string): GiteaNode {
  const node = new GiteaNode('issue', `#${payload.number} ${label}`, vscode.TreeItemCollapsibleState.None, payload);
  node.description = description;
  node.iconPath = toThemeIcon(issueIcon(payload.state));
  node.tooltip = new vscode.MarkdownString(`**#${payload.number}** ${label}\n\n所属：\`${payload.owner}/${payload.repo}\``);
  if (payload.htmlUrl) {
    node.command = { command: 'gitea.openIssue', title: '打开 Issue', arguments: [node] };
  }
  return node;
}

/**
 * 创建 Pull Request 节点。
 * @param label 显示标题
 * @param payload 业务数据
 * @param description 次要说明
 * @returns 节点
 */
export function createPullNode(label: string, payload: PullNodePayload, description?: string): GiteaNode {
  const node = new GiteaNode('pull', `#${payload.number} ${label}`, vscode.TreeItemCollapsibleState.None, payload);
  node.description = description;
  node.iconPath = toThemeIcon(pullIcon(payload));
  const branch = payload.headRef && payload.baseRef ? `\n\n${payload.headRef} → ${payload.baseRef}` : '';
  node.tooltip = new vscode.MarkdownString(
    `**#${payload.number}** ${label}\n\n所属：\`${payload.owner}/${payload.repo}\`${branch}`,
  );
  if (payload.htmlUrl) {
    node.command = { command: 'gitea.openPull', title: '打开 Pull Request', arguments: [node] };
  }
  return node;
}

/**
 * 创建分支节点。
 * @param label 分支名
 * @param payload 业务数据
 * @returns 节点
 */
export function createBranchNode(
  label: string,
  payload: { owner: string; repo: string; name: string; htmlUrl: string },
  protectedBranch: boolean,
): GiteaNode {
  const node = new GiteaNode('branch', label, vscode.TreeItemCollapsibleState.None, payload);
  node.iconPath = toThemeIcon(branchIcon(protectedBranch));
  node.command = { command: 'gitea.openInBrowser', title: '在浏览器打开', arguments: [node] };
  return node;
}

/**
 * 创建提示 / 错误节点。
 * @param message 提示文本
 * @param icon codicon ID
 * @param command 点击执行的命令
 * @returns 节点
 */
export function createMessageNode(
  message: string,
  icon = 'info',
  command?: { command: string; title: string; args?: unknown[] },
): GiteaNode {
  const node = new GiteaNode('message', message, vscode.TreeItemCollapsibleState.None, { message });
  node.iconPath = new vscode.ThemeIcon(icon);
  node.tooltip = message;
  if (command) {
    node.command = { command: command.command, title: command.title, arguments: command.args };
  }
  return node;
}
