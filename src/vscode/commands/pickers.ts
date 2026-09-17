/**
 * 命令层共用的 QuickPick 选择器。
 */
import * as vscode from 'vscode';
import type { RepoRef } from '../../core/repoRef';
import type { GiteaLabel } from '../../core/types';
import type { GiteaService } from '../service';
import type { GiteaNode } from '../views/nodes';

/** 带仓库坐标与序号的节点负载（Issue / PR 节点）。 */
export interface IndexedNodePayload {
  owner: string;
  repo: string;
  number: number;
  htmlUrl?: string;
  /** 条目类型，由节点的 `contextValue` 推断。 */
  kind?: 'issue' | 'pull';
}

/**
 * 从树节点中提取 Issue / PR 坐标。
 * @param node 树节点
 * @returns 坐标；节点负载不完整时返回 undefined
 */
export function readIndexedPayload(node: unknown): IndexedNodePayload | undefined {
  const treeNode = node as GiteaNode | undefined;
  const payload = treeNode?.payload as IndexedNodePayload | undefined;
  if (
    !payload ||
    typeof payload.owner !== 'string' ||
    typeof payload.repo !== 'string' ||
    typeof payload.number !== 'number'
  ) {
    return undefined;
  }
  const kind = treeNode?.contextValue === 'gitea.pull' ? 'pull' : 'issue';
  return { ...payload, kind };
}

/**
 * 确定操作目标仓库：优先使用节点携带的仓库，其次工作区推断，最后让用户选择。
 * @param service Gitea 服务
 * @param node 可选的树节点
 * @returns 仓库坐标；用户取消时返回 undefined
 */
export async function requireRepoRef(service: GiteaService, node?: unknown): Promise<RepoRef | undefined> {
  const fromNode = readIndexedPayload(node);
  if (fromNode?.owner && fromNode.repo) {
    return { owner: fromNode.owner, repo: fromNode.repo };
  }

  const nodePayload = (node as GiteaNode | undefined)?.payload as
    | { owner?: string; name?: string; fullName?: string }
    | undefined;
  if (nodePayload?.owner && nodePayload.name) {
    return { owner: nodePayload.owner, repo: nodePayload.name };
  }

  const fromWorkspace = await service.getDefaultRepo();
  if (fromWorkspace) {
    return fromWorkspace;
  }
  return pickRepo(service);
}

/**
 * 让用户从自己的仓库列表中选择一个仓库。
 * @param service Gitea 服务
 * @returns 仓库坐标；用户取消时返回 undefined
 */
export async function pickRepo(service: GiteaService): Promise<RepoRef | undefined> {
  const operations = await service.getOperations();
  const repositories = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: '正在加载 Gitea 仓库…' },
    () => operations.repos.list({ mine: true, limit: 200 }),
  );

  const picked = await vscode.window.showQuickPick(
    repositories.items.map((repo) => ({
      label: repo.full_name,
      description: repo.description ?? '',
      detail: `默认分支 ${repo.default_branch}${repo.private ? ' · 私有' : ''}`,
      ref: { owner: repo.owner?.login ?? repo.full_name.split('/')[0], repo: repo.name } satisfies RepoRef,
    })),
    { title: '选择 Gitea 仓库', placeHolder: '按仓库全名搜索', matchOnDescription: true },
  );
  return picked?.ref;
}

/**
 * 让用户选择一个分支。
 * @param service Gitea 服务
 * @param ref 仓库坐标
 * @param options 选择器配置
 * @returns 分支名；用户取消时返回 undefined
 */
export async function pickBranch(
  service: GiteaService,
  ref: RepoRef,
  options: { title: string; default?: string } = { title: '选择分支' },
): Promise<string | undefined> {
  const operations = await service.getOperations();
  const branches = await operations.repos.listBranches(ref.owner, ref.repo, 1, 200);
  const picked = await vscode.window.showQuickPick(
    branches.items.map((branch) => ({
      label: branch.name,
      description: branch.name === options.default ? '默认分支' : '',
      detail: branch.commit?.message?.split('\n')[0] ?? '',
    })),
    { title: options.title, matchOnDescription: false },
  );
  return picked?.label;
}

/**
 * 让用户选择仓库标签（可多选）。
 * @param service Gitea 服务
 * @param ref 仓库坐标
 * @returns 标签 ID 列表；用户取消时返回 undefined
 */
export async function pickLabels(service: GiteaService, ref: RepoRef): Promise<number[] | undefined> {
  const operations = await service.getOperations();
  let labels: GiteaLabel[];
  try {
    labels = await operations.issues.listLabels(ref.owner, ref.repo);
  } catch {
    return [];
  }
  if (labels.length === 0) {
    return [];
  }
  const picked = await vscode.window.showQuickPick(
    labels.map((label) => ({ label: label.name, description: label.description ?? '', id: label.id })),
    { title: '选择标签（可多选）', canPickMany: true },
  );
  return picked?.map((item) => item.id) ?? [];
}
