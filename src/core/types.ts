/**
 * Gitea 1.26.x API 实体类型定义。
 *
 * 字段依据 Gitea 1.26.4 的 OpenAPI 规范（`<实例地址>/swagger.v1.json`）逐一核对，
 * 仅保留扩展与 AI 工具实际使用的字段。扩展启动时会校验服务端版本，
 * 与本文件核对所用的版本不一致时向用户告警（见 `src/core/version.ts`）。
 */

/** Gitea 用户。 */
export interface GiteaUser {
  id: number;
  login: string;
  login_name?: string;
  full_name?: string;
  email?: string;
  avatar_url?: string;
  html_url?: string;
  is_admin?: boolean;
  restricted?: boolean;
  active?: boolean;
  created?: string;
  last_login?: string;
  location?: string;
  website?: string;
  description?: string;
}

/** Gitea 组织。 */
export interface GiteaOrganization {
  id: number;
  username: string;
  name?: string;
  full_name?: string;
  avatar_url?: string;
  description?: string;
  website?: string;
  location?: string;
  visibility?: string;
}

/** 仓库权限标记。 */
export interface GiteaRepoPermissions {
  admin?: boolean;
  push?: boolean;
  pull?: boolean;
}

/** Gitea 仓库。 */
export interface GiteaRepository {
  id: number;
  name: string;
  full_name: string;
  owner?: GiteaUser;
  description?: string;
  private: boolean;
  fork: boolean;
  empty?: boolean;
  archived?: boolean;
  mirror?: boolean;
  template?: boolean;
  html_url: string;
  url?: string;
  clone_url?: string;
  ssh_url?: string;
  default_branch: string;
  open_issues_count?: number;
  open_pr_counter?: number;
  stars_count?: number;
  forks_count?: number;
  watchers_count?: number;
  size?: number;
  language?: string;
  topics?: string[];
  has_issues?: boolean;
  has_pull_requests?: boolean;
  has_wiki?: boolean;
  /**
   * 该仓库是否**启用了** Actions 功能。
   *
   * 注意语义：这只表示功能开关（仓库设置里的 unit），**不代表仓库里真的有 workflow 文件** ——
   * 要判断后者必须逐个仓库调 `/actions/workflows`，代价是每仓库一次请求，因此不用于列表角标。
   */
  has_actions?: boolean;
  /** 分支数量。列表接口会带，用于角标。 */
  branch_count?: number;
  /** 发布（Release）数量。 */
  release_counter?: number;
  permissions?: GiteaRepoPermissions;
  created_at?: string;
  updated_at?: string;
}

/** Gitea 标签。 */
export interface GiteaLabel {
  id: number;
  name: string;
  color?: string;
  description?: string;
  exclusive?: boolean;
}

/** Gitea 里程碑。 */
export interface GiteaMilestone {
  id: number;
  title: string;
  state?: string;
  description?: string;
  due_on?: string | null;
  open_issues?: number;
  closed_issues?: number;
}

/** Issue / PR 评论。 */
export interface GiteaComment {
  id: number;
  body?: string;
  user?: GiteaUser;
  created_at?: string;
  updated_at?: string;
  html_url?: string;
  issue_url?: string;
  pull_request_url?: string;
}

/** Issue / PR 的精简引用（Issue 上出现 `pull_request` 字段即代表该条目是 PR）。 */
export interface GiteaIssuePullRequestRef {
  merged?: boolean;
  merged_at?: string | null;
  html_url?: string;
  diff_url?: string;
  patch_url?: string;
}

/** Gitea Issue（Gitea 中 Issue 与 PR 共用该结构，通过 `pull_request` 区分）。 */
export interface GiteaIssue {
  id: number;
  number: number;
  title: string;
  body?: string;
  state: string;
  user?: GiteaUser;
  labels?: GiteaLabel[];
  milestone?: GiteaMilestone | null;
  assignee?: GiteaUser | null;
  assignees?: GiteaUser[] | null;
  comments?: number;
  is_locked?: boolean;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
  due_date?: string | null;
  html_url?: string;
  url?: string;
  repository?: GiteaRepository;
  pull_request?: GiteaIssuePullRequestRef | null;
}

/** PR 分支引用（head / base）。 */
export interface GiteaPullBranchInfo {
  label?: string;
  ref: string;
  sha: string;
  repo_id?: number;
  repo?: GiteaRepository;
}

/** Gitea Pull Request。 */
export interface GiteaPullRequest {
  id: number;
  number: number;
  title: string;
  body?: string;
  state: string;
  user?: GiteaUser;
  labels?: GiteaLabel[];
  milestone?: GiteaMilestone | null;
  assignee?: GiteaUser | null;
  assignees?: GiteaUser[] | null;
  requested_reviewers?: GiteaUser[] | null;
  merged?: boolean;
  merged_at?: string | null;
  merged_by?: GiteaUser | null;
  mergeable?: boolean;
  merge_commit_sha?: string | null;
  draft?: boolean;
  head?: GiteaPullBranchInfo;
  base?: GiteaPullBranchInfo;
  diff_url?: string;
  patch_url?: string;
  html_url?: string;
  comments?: number;
  review_comments?: number;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
  url?: string;
}

/** PR 代码评审。 */
export interface GiteaPullReview {
  id: number;
  state: string;
  body?: string;
  user?: GiteaUser;
  commit_id?: string;
  submitted_at?: string;
  stale?: boolean;
  dismissed?: boolean;
  official?: boolean;
  comments_count?: number;
  html_url?: string;
}

/** PR 变更文件。 */
export interface GiteaChangedFile {
  filename: string;
  previous_filename?: string;
  status?: string;
  additions?: number;
  deletions?: number;
  changes?: number;
  html_url?: string;
  raw_url?: string;
  contents_url?: string;
}

/** Gitea 分支。 */
export interface GiteaBranch {
  name: string;
  commit?: { id: string; message?: string; timestamp?: string; url?: string };
  protected?: boolean;
  user_can_push?: boolean;
  user_can_merge?: boolean;
}

/** Git 提交内层信息。 */
export interface GiteaGitCommit {
  message: string;
  url?: string;
  author?: GiteaCommitUser;
  committer?: GiteaCommitUser;
  tree?: { sha: string; url?: string };
  verification?: { verified?: boolean; reason?: string; signature?: string; payload?: string };
}

/** 提交中的作者 / 提交者（含时间戳）。 */
export interface GiteaCommitUser {
  name: string;
  email: string;
  date?: string;
  username?: string;
}

/** Gitea 提交。 */
export interface GiteaCommit {
  sha: string;
  created?: string;
  url?: string;
  html_url?: string;
  commit?: GiteaGitCommit;
  author?: GiteaUser | null;
  committer?: GiteaUser | null;
  parents?: Array<{ sha: string }>;
  stats?: { additions?: number; deletions?: number; total?: number };
  files?: GiteaChangedFile[];
}

/** 仓库内容条目（文件或目录）。 */
export interface GiteaContentsResponse {
  name: string;
  path: string;
  sha: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  size?: number;
  encoding?: string | null;
  content?: string | null;
  download_url?: string | null;
  html_url?: string | null;
  git_url?: string | null;
  url?: string;
  target?: string | null;
  submodule_git_url?: string | null;
  last_commit_sha?: string;
  last_commit_message?: string;
  last_author_date?: string;
}

/** 文件写操作（创建 / 更新）的响应。 */
export interface GiteaFileResponse {
  content?: GiteaContentsResponse;
  commit?: {
    sha: string;
    html_url?: string;
    message?: string;
    author?: GiteaCommitUser;
    committer?: GiteaCommitUser;
  };
}

/** 通知线程主题。 */
export interface GiteaNotificationSubject {
  title: string;
  url?: string;
  html_url?: string;
  latest_comment_url?: string;
  latest_comment_html_url?: string;
  type?: string;
  state?: string;
}

/** Gitea 通知线程。 */
export interface GiteaNotificationThread {
  id: number;
  unread: boolean;
  pinned: boolean;
  subject: GiteaNotificationSubject;
  repository?: GiteaRepository;
  updated_at?: string;
  url?: string;
}

/** 提交状态（CI）。 */
export interface GiteaCommitStatus {
  id: number;
  status: string;
  context?: string;
  description?: string;
  target_url?: string;
  creator?: GiteaUser;
  created_at?: string;
  updated_at?: string;
}

/** 合并后的提交状态。 */
export interface GiteaCombinedStatus {
  state: string;
  sha: string;
  total_count?: number;
  statuses?: GiteaCommitStatus[];
  repository?: GiteaRepository;
}

/** Gitea Actions 工作流（`.gitea/workflows/*.yml`）。 */
export interface GiteaActionWorkflow {
  id: string;
  name: string;
  path: string;
  /** 启用状态，取值 `active` / `disabled_manually` 等。 */
  state: string;
  badge_url?: string;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string;
  url?: string;
}

/**
 * 工作流运行记录。
 *
 * 注意 Gitea 的命名差异：`/actions/runs` 返回的是 {@link GiteaActionWorkflowRun}（含 `status`/
 * `conclusion`），而 `/actions/tasks` 返回的是另一套结构。这里只用了前者。
 */
export interface GiteaActionWorkflowRun {
  id: number;
  /** 展示标题，通常是触发时的提交信息。 */
  display_title?: string;
  /** 触发事件，如 `push` / `pull_request` / `workflow_dispatch`。 */
  event?: string;
  status?: string;
  conclusion?: string;
  run_number?: number;
  run_attempt?: number;
  head_branch?: string;
  head_sha?: string;
  path?: string;
  html_url?: string;
  url?: string;
  started_at?: string;
  completed_at?: string;
  actor?: GiteaUser;
  trigger_actor?: GiteaUser;
  head_repository?: GiteaRepository;
  repository?: GiteaRepository;
  repository_id?: number;
}

/** 运行中的单个作业（job）。 */
export interface GiteaActionWorkflowJob {
  id: number;
  run_id?: number;
  name: string;
  status?: string;
  conclusion?: string;
  /** 作业所在的运行器标签，如 `ubuntu-latest`。 */
  labels?: string[];
  runner_id?: number;
  runner_name?: string;
  head_branch?: string;
  head_sha?: string;
  run_attempt?: number;
  html_url?: string;
  run_url?: string;
  url?: string;
  started_at?: string;
  completed_at?: string;
  created_at?: string;
  steps?: GiteaActionWorkflowStep[];
}

/** 作业内的单个步骤。 */
export interface GiteaActionWorkflowStep {
  number: number;
  name: string;
  status?: string;
  conclusion?: string;
  started_at?: string;
  completed_at?: string;
}

/** 运行产物（artifact）。 */
export interface GiteaActionArtifact {
  id: number;
  name: string;
  size_in_bytes?: number;
  expired?: boolean;
  expires_at?: string;
  created_at?: string;
  updated_at?: string;
  /** 下载地址（zip，需带 `Authorization` 头才能取到）。 */
  archive_download_url?: string;
  url?: string;
  workflow_run?: GiteaActionWorkflowRun;
}

/** 分页元信息（从响应头 `X-Total-Count` / `Link` 解析）。 */
export interface GiteaPageInfo {
  totalCount?: number;
  hasNextPage: boolean;
}

/** 带分页信息的列表响应。 */
export interface GiteaListResult<T> {
  items: T[];
  pageInfo: GiteaPageInfo;
}

/** Issue / PR 全局搜索的条目类型。 */
export type GiteaIssueSearchType = 'issues' | 'pulls';

/** Issue 状态筛选。 */
export type GiteaIssueState = 'open' | 'closed' | 'all';
