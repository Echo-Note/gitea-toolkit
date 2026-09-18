/**
 * 树节点 → 网页地址 的解析。
 *
 * 优先使用节点自带的 `htmlUrl`（由 provider 从 API 响应填充）；
 * 缺失时按节点类型推导，作为兜底，避免「点了却说没有地址」这种体验。
 */
import {
  branchWebUrl,
  issueWebUrl,
  pullWebUrl,
  repoWebUrl,
  runWebUrl,
  workflowWebUrl,
} from '../../core/urls';
import { readSettings } from '../config';
import type { GiteaNode } from '../views/nodes';

/**
 * 解析节点对应的网页地址。
 * @param node 树节点（命令参数）
 * @returns 网页地址；无法确定时返回 undefined
 */
export function resolveNodeWebUrl(node: unknown): string | undefined {
  const treeNode = node as GiteaNode | undefined;
  if (!treeNode) {
    return undefined;
  }

  const payload = (treeNode.payload ?? {}) as Record<string, unknown>;
  const explicit = asString(payload.htmlUrl);
  if (explicit) {
    return explicit;
  }

  const serverUrl = readSettings().serverUrl;
  if (!serverUrl) {
    return undefined;
  }

  const owner = asString(payload.owner);
  // 仓库节点的负载用 `name` 表示仓库名，其余节点用 `repo`
  const repo = asString(payload.repo) ?? (treeNode.kind === 'repo' ? asString(payload.name) : undefined);
  if (!owner || !repo) {
    return undefined;
  }

  switch (treeNode.kind) {
    case 'repo':
      return repoWebUrl(serverUrl, owner, repo);
    case 'branch': {
      const branch = asString(payload.name);
      return branch ? branchWebUrl(serverUrl, owner, repo, branch) : undefined;
    }
    case 'issue': {
      const index = asNumber(payload.number);
      return index === undefined ? undefined : issueWebUrl(serverUrl, owner, repo, index);
    }
    case 'pull': {
      const index = asNumber(payload.number);
      return index === undefined ? undefined : pullWebUrl(serverUrl, owner, repo, index);
    }
    case 'actionWorkflow': {
      const workflowId = asString(payload.workflowId);
      return workflowId ? workflowWebUrl(serverUrl, owner, repo, workflowId) : undefined;
    }
    case 'actionRun': {
      // 网页链接用的是 run_number（列表上的 #编号），不是 API 的 runId
      const runNumber = asNumber(payload.runNumber);
      return runNumber === undefined ? undefined : runWebUrl(serverUrl, owner, repo, runNumber);
    }
    default:
      return undefined;
  }
}

/**
 * 从任意值中取出非空字符串。
 * @param value 待检查的值
 * @returns 字符串或 undefined
 */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * 从任意值中取出数字。
 * @param value 待检查的值
 * @returns 数字或 undefined
 */
function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
