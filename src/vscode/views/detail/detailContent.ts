/**
 * 详情面板的数据装配。
 *
 * 负责把 Gitea 的 Issue / PR 实体 + 评论 + 变更文件转换为「已渲染好 HTML」的视图模型，
 * 视图层（Webview）只做展示与消息上报，不再关心业务语义。
 *
 * Markdown 一律交给 Gitea 服务端渲染（`POST /markdown`），保证与网页端表现一致；
 * 服务端渲染不可用时降级为 `<pre>` 纯文本。
 */
import { absolutizeHtmlUrls, absolutizeUrl, escapeHtml, relativeTime } from '../../../core/format';
import type { GiteaOperations } from '../../../core/operations';
import type { GiteaComment, GiteaPullReview, GiteaUser } from '../../../core/types';
import { logWarn } from '../../logger';
import { readSettings } from '../../config';

/** 参与人（作者 / 指派 / 评审人）。 */
export interface DetailActor {
  login: string;
  avatar: string;
}

/** 一条评论。 */
export interface DetailComment {
  id: number;
  author: DetailActor;
  createdAgo: string;
  createdAt: string;
  bodyHtml: string;
}

/** 变更文件。 */
export interface DetailFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
}

/** 标签（含对比色，便于 Webview 直接渲染）。 */
export interface DetailLabel {
  name: string;
  color: string;
  textColor: string;
}

/** 一条评审记录。 */
export interface DetailReview {
  id: number;
  author: DetailActor;
  state: string;
  stateText: string;
  submittedAgo: string;
  bodyHtml: string;
}

/** 详情面板视图模型。 */
export interface DetailViewModel {
  kind: 'issue' | 'pull';
  owner: string;
  repo: string;
  number: number;
  title: string;
  state: string;
  isClosed: boolean;
  isMerged: boolean;
  isDraft: boolean;
  author: DetailActor;
  createdAt: string;
  createdAgo: string;
  updatedAgo: string;
  htmlUrl: string;
  bodyHtml: string;
  labels: DetailLabel[];
  assignees: DetailActor[];
  milestone: string;
  comments: DetailComment[];
  /** PR 专有字段 */
  headRef: string;
  baseRef: string;
  mergeable: boolean | undefined;
  additions: number;
  deletions: number;
  changedFiles: number;
  files: DetailFile[];
  reviews: DetailReview[];
}

/** 面板标题所需的最小信息。 */
export interface DetailTarget {
  owner: string;
  repo: string;
  number: number;
  kind: 'issue' | 'pull';
}

/**
 * 构造 Issue 详情视图模型。
 * @param operations Gitea 操作集合
 * @param target 目标坐标
 * @returns 视图模型
 */
export async function buildIssueDetail(
  operations: GiteaOperations,
  target: DetailTarget,
): Promise<DetailViewModel> {
  const { owner, repo, number } = target;
  const [issue, comments] = await Promise.all([
    operations.issues.get(owner, repo, number),
    operations.issues.listComments(owner, repo, number, 1, 200),
  ]);

  const branch = issue.repository?.default_branch ?? 'main';
  const context = `/${owner}/${repo}/src/${branch}`;

  return {
    kind: 'issue',
    owner,
    repo,
    number,
    title: issue.title,
    state: issue.state,
    isClosed: issue.state !== 'open',
    isMerged: false,
    isDraft: false,
    author: toActor(issue.user),
    createdAt: issue.created_at ?? '',
    createdAgo: relativeTime(issue.created_at),
    updatedAgo: relativeTime(issue.updated_at),
    htmlUrl: issue.html_url ?? '',
    bodyHtml: await renderMarkdownSafe(operations, issue.body, context),
    labels: (issue.labels ?? []).map(toLabel),
    assignees: (issue.assignees ?? []).map(toActor),
    milestone: issue.milestone?.title ?? '',
    comments: await renderComments(operations, comments.items, context),
    headRef: '',
    baseRef: '',
    mergeable: undefined,
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    files: [],
    reviews: [],
  };
}

/**
 * 构造 Pull Request 详情视图模型。
 * @param operations Gitea 操作集合
 * @param target 目标坐标
 * @returns 视图模型
 */
export async function buildPullDetail(
  operations: GiteaOperations,
  target: DetailTarget,
): Promise<DetailViewModel> {
  const { owner, repo, number } = target;
  const [pull, comments, files, reviews] = await Promise.all([
    operations.pulls.get(owner, repo, number),
    operations.issues.listComments(owner, repo, number, 1, 200),
    operations.pulls.listFiles(owner, repo, number).catch((error) => {
      logWarn('读取 PR 变更文件失败', error);
      return [];
    }),
    operations.pulls.listReviews(owner, repo, number).catch((error) => {
      logWarn('读取 PR 评审记录失败', error);
      return [];
    }),
  ]);

  const base = pull.base?.ref ?? 'main';
  const context = `/${owner}/${repo}/src/${base}`;

  return {
    kind: 'pull',
    owner,
    repo,
    number,
    title: pull.title,
    state: pull.state,
    isClosed: pull.state !== 'open',
    isMerged: Boolean(pull.merged),
    isDraft: Boolean(pull.draft),
    author: toActor(pull.user),
    createdAt: pull.created_at ?? '',
    createdAgo: relativeTime(pull.created_at),
    updatedAgo: relativeTime(pull.updated_at),
    htmlUrl: pull.html_url ?? '',
    bodyHtml: await renderMarkdownSafe(operations, pull.body, context),
    labels: (pull.labels ?? []).map(toLabel),
    assignees: (pull.assignees ?? []).map(toActor),
    milestone: pull.milestone?.title ?? '',
    comments: await renderComments(operations, comments.items, context),
    headRef: pull.head?.ref ?? '',
    baseRef: base,
    mergeable: pull.mergeable,
    additions: pull.additions ?? 0,
    deletions: pull.deletions ?? 0,
    changedFiles: pull.changed_files ?? 0,
    files: files.map((file) => ({
      filename: file.filename,
      status: file.status ?? 'modified',
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
    })),
    reviews: await renderReviews(operations, reviews, context),
  };
}

/**
 * 根据目标类型构造视图模型。
 * @param operations Gitea 操作集合
 * @param target 目标坐标
 * @returns 视图模型
 */
export function buildDetail(
  operations: GiteaOperations,
  target: DetailTarget,
): Promise<DetailViewModel> {
  return target.kind === 'pull' ? buildPullDetail(operations, target) : buildIssueDetail(operations, target);
}

/**
 * 渲染评论列表。
 * @param operations Gitea 操作集合
 * @param comments 评论
 * @param context 渲染上下文
 * @returns 渲染后的评论
 */
async function renderComments(
  operations: GiteaOperations,
  comments: GiteaComment[],
  context: string,
): Promise<DetailComment[]> {
  return Promise.all(
    comments.map(async (comment) => ({
      id: comment.id,
      author: toActor(comment.user),
      createdAt: comment.created_at ?? '',
      createdAgo: relativeTime(comment.created_at),
      bodyHtml: await renderMarkdownSafe(operations, comment.body, context),
    })),
  );
}

/**
 * 渲染评审记录（仅保留有正文或明确结论的条目）。
 * @param operations Gitea 操作集合
 * @param reviews 评审
 * @param context 渲染上下文
 * @returns 渲染后的评审
 */
async function renderReviews(
  operations: GiteaOperations,
  reviews: GiteaPullReview[],
  context: string,
): Promise<DetailReview[]> {
  const visible = reviews.filter((review) => (review.body ?? '').trim().length > 0 || review.state !== 'PENDING');
  return Promise.all(
    visible.map(async (review) => ({
      id: review.id,
      author: toActor(review.user),
      state: review.state,
      stateText: reviewStateText(review.state),
      submittedAgo: relativeTime(review.submitted_at),
      bodyHtml: await renderMarkdownSafe(operations, review.body, context),
    })),
  );
}

/**
 * 安全渲染 Markdown：失败时降级为纯文本，不阻断整个详情页。
 * @param operations Gitea 操作集合
 * @param text Markdown 原文
 * @param context 渲染上下文
 * @returns HTML 片段
 */
async function renderMarkdownSafe(
  operations: GiteaOperations,
  text: string | null | undefined,
  context: string,
): Promise<string> {
  const raw = (text ?? '').trim();
  if (raw.length === 0) {
    return '<p class="muted">（无内容）</p>';
  }
  const serverUrl = readSettings().serverUrl;
  try {
    const html = await operations.misc.renderMarkdown(raw, { context, mode: 'comment' });
    return absolutizeHtmlUrls(html, serverUrl);
  } catch (error) {
    logWarn('服务端 Markdown 渲染失败，降级为纯文本', error);
    return `<pre class="raw">${escapeHtml(raw)}</pre>`;
  }
}

/**
 * 把用户实体转换为面板可用的参与人信息。
 * @param user 用户
 * @returns 参与人
 */
function toActor(user: GiteaUser | null | undefined): DetailActor {
  const serverUrl = readSettings().serverUrl;
  return {
    login: user?.login ?? 'unknown',
    avatar: absolutizeUrl(user?.avatar_url, serverUrl),
  };
}

/**
 * 把标签转换为带对比色的渲染信息。
 * @param label Gitea 标签
 * @returns 面板标签
 */
function toLabel(label: { name: string; color?: string }): DetailLabel {
  const color = normalizeHex(label.color);
  return { name: label.name, color, textColor: pickTextColor(color) };
}

/**
 * 归一化十六进制颜色。
 * @param value 原始颜色（可能不带 `#`）
 * @returns `#rrggbb` 形式的颜色
 */
function normalizeHex(value: string | undefined): string {
  const raw = (value ?? '').replace(/^#/, '').trim();
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    return `#${raw.toLowerCase()}`;
  }
  return '#8b949e';
}

/**
 * 依据背景亮度选择前景色，保证标签文字可读。
 * @param hex `#rrggbb` 颜色
 * @returns `#000000` 或 `#ffffff`
 */
function pickTextColor(hex: string): string {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const toLinear = (channel: number): number =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return luminance > 0.45 ? '#000000' : '#ffffff';
}

/**
 * 评审状态的中文描述。
 * @param state Gitea 评审状态
 * @returns 中文描述
 */
function reviewStateText(state: string): string {
  switch (state) {
    case 'APPROVED':
      return '已批准';
    case 'REQUEST_CHANGES':
      return '请求修改';
    case 'COMMENT':
      return '评论';
    case 'PENDING':
      return '待处理';
    default:
      return state;
  }
}
