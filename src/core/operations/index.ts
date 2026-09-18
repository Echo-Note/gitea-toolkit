/**
 * Gitea 业务操作门面。
 *
 * 将 {@link GiteaClient} 暴露的能力按领域聚合，供 VS Code 扩展 UI 与 AI 工具共用，
 * 保证「界面点一下」与「AI 调一次」走的是同一套代码路径与语义。
 */
import type { GiteaClient } from '../giteaClient';
import { ActionOperations } from './actions';
import { IssueOperations } from './issues';
import { MiscOperations } from './misc';
import { PullOperations } from './pulls';
import { RepoOperations } from './repos';

export type {
  DispatchWorkflowOptions,
  ListActionRunsOptions,
  ListArtifactsOptions,
  ListWorkflowsOptions,
} from './actions';
export type { CreateIssueOptions, ListIssuesOptions, UpdateIssueOptions } from './issues';
export type { CreatePullOptions, ListPullsOptions, MergePullOptions, ReviewPullOptions } from './pulls';
export type {
  CommitFileOptions,
  CreateRepoOptions,
  ListCommitsOptions,
  ListReposOptions,
  RepoFileContent,
} from './repos';
export type { ListNotificationsOptions } from './misc';

/** 聚合后的 Gitea 操作集合。 */
export class GiteaOperations {
  /** 仓库相关操作。 */
  public readonly repos: RepoOperations;
  /** Issue 相关操作。 */
  public readonly issues: IssueOperations;
  /** Pull Request 相关操作。 */
  public readonly pulls: PullOperations;
  /** 用户 / 组织 / 通知相关操作。 */
  public readonly misc: MiscOperations;
  /** Gitea Actions（工作流 / 运行 / 作业日志 / 产物）相关操作。 */
  public readonly actions: ActionOperations;

  constructor(client: GiteaClient) {
    this.repos = new RepoOperations(client);
    this.issues = new IssueOperations(client);
    this.pulls = new PullOperations(client);
    this.misc = new MiscOperations(client);
    this.actions = new ActionOperations(client);
  }
}
