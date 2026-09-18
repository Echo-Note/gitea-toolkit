/**
 * 工具实现共用的解析与格式化辅助函数。
 */
import type {
  GiteaActionArtifact,
  GiteaActionWorkflow,
  GiteaActionWorkflowJob,
  GiteaActionWorkflowRun,
  GiteaComment,
  GiteaIssue,
  GiteaPullRequest,
  GiteaRepository,
} from '../../core/types';
import type { RepoRef } from '../../core/repoRef';
import { relativeTime, truncate } from '../../core/format';
import { ToolInputError, type GiteaToolContext } from './types';

export { relativeTime, truncate };

/**
 * 解析工具调用所需的仓库坐标。
 * 优先使用显式参数，其次回退到当前工作区推断出的默认仓库。
 * @param input 工具入参
 * @param ctx 执行上下文
 * @returns 仓库坐标
 * @throws ToolInputError 无法确定仓库时抛出
 */
export function resolveRepoRef(input: Record<string, unknown>, ctx: GiteaToolContext): RepoRef {
  const owner = typeof input.owner === 'string' ? input.owner.trim() : '';
  const repo = typeof input.repo === 'string' ? input.repo.trim() : '';
  if (owner && repo) {
    return { owner, repo };
  }
  if (!owner && !repo && ctx.defaultRepo) {
    return ctx.defaultRepo;
  }
  if (owner && !repo && ctx.defaultRepo && ctx.defaultRepo.owner === owner) {
    return ctx.defaultRepo;
  }
  throw new ToolInputError(
    '无法确定目标仓库。请显式提供 `owner` 与 `repo` 参数；' +
      '若当前工作区打开的是 Gitea 仓库，也可以省略这两个参数（将从 git origin 远端推断）。',
  );
}

/**
 * 生成仓库的 Markdown 列表行。
 * @param repo 仓库
 * @returns 单行 Markdown
 */
export function formatRepoLine(repo: GiteaRepository): string {
  const flags: string[] = [];
  if (repo.private) flags.push('私有');
  if (repo.fork) flags.push('Fork');
  if (repo.archived) flags.push('已归档');
  if (repo.empty) flags.push('空仓库');
  const suffix = flags.length > 0 ? ` _(${flags.join('/')})_` : '';
  const description = repo.description ? ` — ${repo.description}` : '';
  return `- **${repo.full_name}**${suffix}${description}\n  默认分支 \`${repo.default_branch}\`，未关闭 Issue ${repo.open_issues_count ?? 0}，开放 PR ${repo.open_pr_counter ?? 0}，更新于 ${relativeTime(repo.updated_at)}`;
}

/**
 * 生成 Issue / PR 的 Markdown 列表行。
 * @param issue Issue 或 PR
 * @returns 单行 Markdown
 */
export function formatIssueLine(issue: GiteaIssue): string {
  const kind = issue.pull_request ? 'PR' : 'Issue';
  const labels = (issue.labels ?? []).map((label) => `\`${label.name}\``).join(' ');
  const assignees = (issue.assignees ?? []).map((user) => user.login).join(', ');
  const extras: string[] = [];
  if (labels) extras.push(labels);
  if (assignees) extras.push(`指派 ${assignees}`);
  if (issue.comments) extras.push(`${issue.comments} 条评论`);
  const suffix = extras.length > 0 ? `\n  ${extras.join(' · ')}` : '';
  return `- #${issue.number} [${kind}] **${issue.title}**（${issue.state}，@${issue.user?.login ?? 'unknown'}，${relativeTime(issue.updated_at)}）${suffix}`;
}

/**
 * 生成 PR 的 Markdown 列表行。
 * @param pull PR
 * @returns 单行 Markdown
 */
export function formatPullLine(pull: GiteaPullRequest): string {
  const branch = pull.head?.ref && pull.base?.ref ? `${pull.head.ref} → ${pull.base.ref}` : '';
  const flags: string[] = [];
  if (pull.draft) flags.push('草稿');
  if (pull.merged) flags.push('已合并');
  flags.push(pull.state);
  return `- #${pull.number} **${pull.title}**（${flags.join('/')}${branch ? `，${branch}` : ''}，@${pull.user?.login ?? 'unknown'}，${relativeTime(pull.updated_at)}）`;
}

/**
 * 生成评论的 Markdown 摘要。
 * @param comment 评论
 * @param index 序号（从 1 开始）
 * @returns Markdown 文本
 */
export function formatComment(comment: GiteaComment, index: number): string {
  const author = comment.user?.login ?? 'unknown';
  const body = (comment.body ?? '').trim();
  return `**${index}. @${author}**（${relativeTime(comment.created_at)}）\n\n${body}`;
}

/**
 * 将 issue / PR 的正文按需截断。
 * @param body 正文
 * @param max 最大长度
 * @returns 正文
 */
export function formatBody(body: string | null | undefined, max = 8000): string {
  const text = (body ?? '').trim();
  if (text.length === 0) {
    return '_（无正文）_';
  }
  return truncate(text, max);
}

/**
 * 把 Actions 的状态 / 结论翻译成人类可读的中文标签。
 *
 * Gitea 的 `status` 与 `conclusion` 是两套取值（运行中看 `status`，结束后看 `conclusion`），
 * 这里合并成一个标签，避免 AI 把 `completed` 当成「成功」。
 * @param status 运行/作业状态
 * @param conclusion 运行/作业结论
 * @returns 中文标签
 */
export function actionStateLabel(status?: string, conclusion?: string): string {
  const map: Record<string, string> = {
    success: '成功',
    failure: '失败',
    cancelled: '已取消',
    skipped: '已跳过',
    neutral: '中性',
    timed_out: '超时',
    action_required: '需要处理',
    running: '运行中',
    in_progress: '运行中',
    queued: '排队中',
    waiting: '等待中',
    completed: '已完成',
  };
  const key = (conclusion ?? '').trim() || (status ?? '').trim();
  if (key.length === 0) {
    return '未知';
  }
  return map[key] ?? key;
}

/**
 * 生成工作流的 Markdown 列表行。
 * @param workflow 工作流
 * @returns 单行 Markdown
 */
export function formatWorkflowLine(workflow: GiteaActionWorkflow): string {
  const enabled = workflow.state === 'active' ? '已启用' : `已停用（${workflow.state}）`;
  return `- **${workflow.name}**（\`${workflow.path}\`，${enabled}）\n  ID \`${workflow.id}\`，更新于 ${relativeTime(workflow.updated_at)}`;
}

/**
 * 生成运行记录的 Markdown 列表行。
 * @param run 运行记录
 * @returns 单行 Markdown
 */
export function formatRunLine(run: GiteaActionWorkflowRun): string {
  const title = run.display_title ?? run.path ?? '(无标题)';
  const branch = run.head_branch ? `，\`${run.head_branch}\`` : '';
  const event = run.event ? `，${run.event}` : '';
  const actor = run.actor?.login ? `，@${run.actor.login}` : '';
  return `- **#${run.run_number ?? run.id}** [${actionStateLabel(run.status, run.conclusion)}] ${title}${event}${branch}${actor}（${relativeTime(run.started_at ?? run.completed_at)}）\n  run id \`${run.id}\``;
}

/**
 * 生成作业的 Markdown 列表行。
 * @param job 作业
 * @returns 单行 Markdown
 */
export function formatJobLine(job: GiteaActionWorkflowJob): string {
  const runner = job.runner_name ? `，运行器 ${job.runner_name}` : '';
  return `- **${job.name}** [${actionStateLabel(job.status, job.conclusion)}]${runner}（${relativeTime(job.started_at ?? job.completed_at)}）\n  job id \`${job.id}\``;
}

/**
 * 生成产物的 Markdown 列表行。
 * @param artifact 产物
 * @returns 单行 Markdown
 */
export function formatArtifactLine(artifact: GiteaActionArtifact): string {
  const size = formatBytes(artifact.size_in_bytes);
  const expired = artifact.expired ? '，**已过期**' : '';
  return `- **${artifact.name}**（${size}${expired}，创建于 ${relativeTime(artifact.created_at)}）\n  ID \`${artifact.id}\``;
}

/**
 * 把字节数格式化为易读字符串。
 * @param bytes 字节数
 * @returns 形如 `1.2 MB`；未知时返回 `未知大小`
 */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return '未知大小';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/**
 * 取文本的最后若干行。
 *
 * 作业日志动辄上千行，而**出错信息几乎总在末尾**，因此默认保留尾部而非头部。
 * @param text 原始文本
 * @param maxLines 保留的最大行数
 * @returns 截断后的文本与是否发生了截断
 */
export function tailLines(text: string, maxLines: number): { text: string; truncated: boolean } {
  const lines = text.split(/\r?\n/);
  if (lines.length <= maxLines) {
    return { text, truncated: false };
  }
  return { text: lines.slice(lines.length - maxLines).join('\n'), truncated: true };
}
