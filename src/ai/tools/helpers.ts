/**
 * 工具实现共用的解析与格式化辅助函数。
 */
import type { GiteaComment, GiteaIssue, GiteaPullRequest, GiteaRepository } from '../../core/types';
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
