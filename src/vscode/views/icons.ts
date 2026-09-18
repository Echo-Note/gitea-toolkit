/**
 * 树节点图标与配色。
 *
 * 设计约定：
 *   - 本文件**不依赖 `vscode` 模块**，只产出 {@link IconSpec} 纯数据。
 *     好处：可以被 `scripts/preview-tree.mjs` 直接打包，用真实 codicon 字体把侧边栏渲染出来核对
 *     （VS Code 对拼错的图标名是**静默忽略**的，肉眼看不出问题，必须能离线验证）。
 *     转换成 `vscode.ThemeIcon` 的职责在 `nodes.ts` 的 `toThemeIcon()`。
 *   - 一律使用内置 codicon，不引入图片资源
 *   - 需要表达状态时叠加 `charts.*` 主题色，浅色 / 深色主题自动适配，无需维护两套资源
 */

/** 图标描述（与 `vscode.ThemeIcon` 一一对应）。 */
export interface IconSpec {
  /** codicon ID，例如 `git-branch`。 */
  id: string;
  /** 可选的 `charts.*` 主题色 ID。 */
  color?: string;
}

/** 状态语义色（VS Code 主题色 ID）。 */
export const COLOR = {
  /** 进行中 / 通过。 */
  open: 'charts.green',
  /** 已关闭 / 已合并。 */
  closed: 'charts.purple',
  /** 异常 / 被拒。 */
  danger: 'charts.red',
  /** 需要注意（受保护）。 */
  warn: 'charts.yellow',
  /** 信息（未读）。 */
  info: 'charts.blue',
} as const;

/**
 * 构造图标描述。
 * @param id codicon ID
 * @param color 可选的 `charts.*` 主题色
 * @returns 图标描述
 */
function icon(id: string, color?: string): IconSpec {
  return color ? { id, color } : { id };
}

/** 仓库节点的区分标记。 */
export interface RepoIconFlags {
  private?: boolean;
  archived?: boolean;
  fork?: boolean;
  empty?: boolean;
}

/**
 * 仓库节点图标：按「归档 → Fork → 私有 → 普通」优先级区分。
 * @param flags 仓库标记
 * @returns 图标描述
 */
export function repoIcon(flags: RepoIconFlags = {}): IconSpec {
  if (flags.archived) {
    return icon('archive', COLOR.warn);
  }
  if (flags.fork) {
    return icon('repo-forked');
  }
  if (flags.private) {
    return icon('lock');
  }
  return icon('repo');
}

/** 分组节点图标（分支 / Issue / PR 分类容器）。 */
export const groupIcons = {
  /** 分支分组。 */
  branches: (): IconSpec => icon('git-branch'),
  /** 打开的 Issue 分组。 */
  issues: (): IconSpec => icon('issue-opened', COLOR.open),
  /** 打开的 PR 分组。 */
  pulls: (): IconSpec => icon('git-pull-request', COLOR.open),
  /** 组织（按 owner 分组仓库）。 */
  owners: (): IconSpec => icon('organization'),
};

/**
 * 分支节点图标：受保护分支用锁 + 警示色。
 * @param protectedBranch 是否受保护
 * @returns 图标描述
 */
export function branchIcon(protectedBranch: boolean): IconSpec {
  return protectedBranch ? icon('lock', COLOR.warn) : icon('git-branch');
}

/**
 * Issue 节点图标。
 * @param state Issue 状态（`open` / `closed`）
 * @returns 图标描述
 */
export function issueIcon(state: string): IconSpec {
  return state === 'open' ? icon('issue-opened', COLOR.open) : icon('issue-closed', COLOR.closed);
}

/**
 * Pull Request 节点图标：已合并 → 已关闭未合并 → 草稿 → 进行中。
 * @param state PR 状态
 * @returns 图标描述
 */
export function pullIcon(state: { state: string; merged?: boolean; draft?: boolean }): IconSpec {
  if (state.merged) {
    return icon('git-merge', COLOR.closed);
  }
  if (state.state !== 'open') {
    return icon('git-pull-request-closed', COLOR.danger);
  }
  if (state.draft) {
    return icon('git-pull-request-draft');
  }
  return icon('git-pull-request', COLOR.open);
}

/**
 * 通知节点图标：按主题类型选图标，未读时用信息色标出。
 * @param subjectType 主题类型（`Issue` / `Pull` / `Commit` / `Repository`）
 * @param unread 是否未读
 * @returns 图标描述
 */
export function notificationIcon(subjectType: string | undefined, unread: boolean): IconSpec {
  const byType: Record<string, string> = {
    Issue: 'issue-opened',
    Pull: 'git-pull-request',
    Commit: 'git-commit',
    Repository: 'repo',
  };
  return unread ? icon(byType[subjectType ?? ''] ?? 'bell', COLOR.info) : icon(byType[subjectType ?? ''] ?? 'bell');
}

/** 「我的 Issue」视图三个分组的图标。 */
export const issueGroupIcons = {
  /** 分配给我。 */
  assigned: (): IconSpec => icon('account'),
  /** 我创建的。 */
  created: (): IconSpec => icon('edit'),
  /** 提及我的。 */
  mentioned: (): IconSpec => icon('mention'),
};

/** 「我的 Pull Request」视图三个分组的图标。 */
export const pullGroupIcons = {
  /** 待我评审。 */
  reviewRequested: (): IconSpec => icon('eye'),
  /** 我创建的。 */
  created: (): IconSpec => icon('edit'),
  /** 全部打开。 */
  all: (): IconSpec => icon('git-pull-request', COLOR.open),
};

/** Gitea Actions 相关分组图标。 */
export const actionIcons = {
  /** 工作流分组。 */
  workflows: (): IconSpec => icon('symbol-event'),
  /** 运行记录分组。 */
  runs: (): IconSpec => icon('history'),
};

/**
 * 工作流节点图标：启用为播放键，停用为禁止符，状态未知为普通事件图标。
 *
 * `state` 为空串表示**状态未知** —— 当 Gitea 的 `/actions/workflows` 返回空、
 * 我们回落到直接列工作流文件时就是这样（见 `reposProvider.loadWorkflows`）。
 * 这时不能画成「禁止符」，那等于凭空断言它被停用了。
 * @param state 工作流状态（`active` 表示启用，空串表示未知）
 * @returns 图标描述
 */
export function workflowIcon(state: string): IconSpec {
  if (state === '') {
    return icon('symbol-event');
  }
  return state === 'active' ? icon('play', COLOR.open) : icon('circle-slash', COLOR.warn);
}

/**
 * Actions 运行 / 作业的状态图标。
 *
 * Gitea 把「进行中」放在 `status`、「最终结果」放在 `conclusion`，两者取其一即可判断，
 * 因此这里合并处理（与 AI 工具侧的 `actionStateLabel` 保持同一套语义）。
 *
 * 进行中使用 `sync~spin`：`~spin` 是 VS Code 的动画修饰符，不是 codicon 名字，
 * 校验脚本 `scripts/preview-tree.mjs` 会先剥离修饰符再比对字体。
 * @param status 状态
 * @param conclusion 结论
 * @returns 图标描述
 */
export function actionStateIcon(status?: string, conclusion?: string): IconSpec {
  const key = (conclusion ?? '').trim() || (status ?? '').trim();
  switch (key) {
    case 'success':
      return icon('check', COLOR.open);
    case 'failure':
    case 'timed_out':
    case 'action_required':
      return icon('x', COLOR.danger);
    case 'cancelled':
      return icon('circle-slash', COLOR.closed);
    case 'skipped':
    case 'neutral':
      return icon('circle-slash');
    case 'running':
    case 'in_progress':
      return icon('sync~spin', COLOR.info);
    case 'queued':
    case 'waiting':
      return icon('clock', COLOR.warn);
    default:
      return icon('circle-outline');
  }
}

/** 提示 / 空状态节点使用的裸 codicon（无主题色）。 */
export const messageIcons = {
  /** 未配置令牌。 */
  noToken: 'key',
  /** 没有仓库。 */
  noRepo: 'repo',
  /** 没有分支。 */
  noBranch: 'git-branch',
  /** 没有 Issue。 */
  noIssue: 'issue-opened',
  /** 没有 PR。 */
  noPull: 'git-pull-request',
  /** 没有通知。 */
  noNotification: 'bell',
  /** 没有 Actions 工作流。 */
  noWorkflow: 'symbol-event',
  /** 没有 Actions 运行记录。 */
  noRun: 'history',
  /** 加载失败。 */
  error: 'error',
  /** 还有更多。 */
  more: 'ellipsis',
} as const;
