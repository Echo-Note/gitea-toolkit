/**
 * 「仓库」视图：仓库列表 → 分支 / 打开的 Issue / 打开的 Pull Request / Actions。
 */
import * as vscode from 'vscode';
import { branchWebUrl, runWebUrl, workflowWebUrl } from '../../core/urls';
import { readSettings } from '../config';
import type { GiteaService } from '../service';
import { BaseTreeProvider } from './baseProvider';
import { actionIcons, groupIcons, messageIcons } from './icons';
import {
  createActionJobNode,
  createActionRunNode,
  createActionWorkflowNode,
  createBranchNode,
  createGroupNode,
  createIssueNode,
  createMessageNode,
  createPullNode,
  createRepoNode,
  GiteaNode,
  type PullNodePayload,
} from './nodes';

/** 仓库树视图提供者。 */
export class ReposProvider extends BaseTreeProvider {
  /**
   * @param service Gitea 服务
   */
  constructor(service: GiteaService) {
    super(service);
  }

  /** @inheritdoc */
  protected async getRootNodes(): Promise<GiteaNode[]> {
    const operations = await this.service.getOperations();
    const settings = readSettings();
    const result = await operations.repos.list({ mine: true, limit: settings.pageSize });

    if (result.items.length === 0) {
      return [
        createMessageNode('当前账号下没有仓库，点击右侧图标新建。', messageIcons.noRepo, {
          command: 'gitea.createRepo',
          title: '新建仓库',
        }),
      ];
    }

    const nodes = result.items.map((repo) =>
      createRepoNode(
        {
          owner: repo.owner?.login ?? repo.full_name.split('/')[0],
          name: repo.name,
          fullName: repo.full_name,
          defaultBranch: repo.default_branch,
          htmlUrl: repo.html_url,
          cloneUrl: repo.clone_url,
          // 以下标记只影响图标，用于一眼区分私有 / 归档 / Fork / 空仓库
          private: repo.private,
          archived: repo.archived,
          fork: repo.fork,
          empty: repo.empty,
        },
        () => this.loadRepoChildren(repo.owner?.login ?? repo.full_name.split('/')[0], repo.name),
      ),
    );

    if (result.pageInfo.hasNextPage) {
      nodes.push(createMessageNode('仅显示前若干条，可在设置中调大 gitea.pageSize。', messageIcons.more));
    }
    return nodes;
  }

  /**
   * 加载仓库下的分组节点。
   * @param owner 所属者
   * @param repo 仓库名
   * @returns 分组节点
   */
  private async loadRepoChildren(owner: string, repo: string): Promise<GiteaNode[]> {
    return [
      createGroupNode('分支', groupIcons.branches(), () => this.loadBranches(owner, repo)),
      createGroupNode('打开的 Issue', groupIcons.issues(), () => this.loadIssues(owner, repo)),
      createGroupNode('打开的 Pull Request', groupIcons.pulls(), () => this.loadPulls(owner, repo)),
      createGroupNode('Actions', actionIcons.runs(), () => this.loadActionGroups(owner, repo)),
    ];
  }

  /**
   * 加载 Actions 下的二级分组。
   *
   * 之所以再分一层而不是直接混排：工作流是「定义」，运行记录是「执行结果」，
   * 混在一起会让「有 3 个工作流、37 次运行」看起来像 40 个同类条目。
   * @param owner 所属者
   * @param repo 仓库名
   * @returns 分组节点
   */
  private async loadActionGroups(owner: string, repo: string): Promise<GiteaNode[]> {
    return [
      createGroupNode('工作流', actionIcons.workflows(), () => this.loadWorkflows(owner, repo)),
      createGroupNode('最近运行', actionIcons.runs(), () => this.loadActionRuns(owner, repo)),
    ];
  }

  /**
   * 加载工作流列表。
   * @param owner 所属者
   * @param repo 仓库名
   * @returns 工作流节点
   */
  private async loadWorkflows(owner: string, repo: string): Promise<GiteaNode[]> {
    const operations = await this.service.getOperations();
    const workflows = await operations.actions.listWorkflows({ owner, repo });
    if (workflows.length === 0) {
      return [createMessageNode('没有配置 Actions 工作流。', messageIcons.noWorkflow)];
    }
    const serverUrl = readSettings().serverUrl;
    return workflows.map((workflow) =>
      createActionWorkflowNode({
        owner,
        repo,
        workflowId: workflow.id,
        name: workflow.name,
        state: workflow.state,
        // 工作流响应通常带 html_url，缺失时按路由规则自拼，避免「点了没反应」
        htmlUrl: workflow.html_url ?? workflowWebUrl(serverUrl, owner, repo, workflow.id),
      }),
    );
  }

  /**
   * 加载最近的运行记录。
   * @param owner 所属者
   * @param repo 仓库名
   * @returns 运行节点
   */
  private async loadActionRuns(owner: string, repo: string): Promise<GiteaNode[]> {
    const operations = await this.service.getOperations();
    const result = await operations.actions.listRuns({ owner, repo, limit: 20 });
    if (result.items.length === 0) {
      return [createMessageNode('没有 Actions 运行记录。', messageIcons.noRun)];
    }
    const serverUrl = readSettings().serverUrl;
    const nodes = result.items.map((run) =>
      createActionRunNode(
        `#${run.run_number ?? run.id} ${run.display_title ?? run.path ?? ''}`.trim(),
        {
          owner,
          repo,
          runId: run.id,
          runNumber: run.run_number ?? run.id,
          title: run.display_title ?? '',
          status: run.status,
          conclusion: run.conclusion,
          htmlUrl: run.html_url ?? runWebUrl(serverUrl, owner, repo, run.run_number ?? run.id),
        },
        () => this.loadActionJobs(owner, repo, run.id),
      ),
    );
    if (result.pageInfo.hasNextPage) {
      nodes.push(createMessageNode('仅显示最近 20 条运行记录。', messageIcons.more));
    }
    return nodes;
  }

  /**
   * 加载某次运行下的作业。
   * @param owner 所属者
   * @param repo 仓库名
   * @param runId 运行 ID
   * @returns 作业节点
   */
  private async loadActionJobs(owner: string, repo: string, runId: number): Promise<GiteaNode[]> {
    const operations = await this.service.getOperations();
    const jobs = await operations.actions.listRunJobs(owner, repo, runId);
    if (jobs.length === 0) {
      return [createMessageNode('该运行暂无作业（可能仍在排队）。', messageIcons.noRun)];
    }
    return jobs.map((job) =>
      createActionJobNode({
        owner,
        repo,
        jobId: job.id,
        name: job.name,
        status: job.status,
        conclusion: job.conclusion,
        htmlUrl: job.html_url,
      }),
    );
  }

  /**
   * 加载分支列表。
   * @param owner 所属者
   * @param repo 仓库名
   * @returns 分支节点
   */
  private async loadBranches(owner: string, repo: string): Promise<GiteaNode[]> {
    const operations = await this.service.getOperations();
    const result = await operations.repos.listBranches(owner, repo, 1, 50);
    if (result.items.length === 0) {
      return [createMessageNode('没有分支。', messageIcons.noBranch)];
    }
    const serverUrl = readSettings().serverUrl;
    return result.items.map((branch) => {
      // Branch 结构里没有 html_url 字段，需按 Gitea 路由规则自行拼接，
      // 否则「在浏览器打开」会因缺少地址而失败。
      const htmlUrl = branchWebUrl(serverUrl, owner, repo, branch.name);
      const node = createBranchNode(
        branch.name,
        { owner, repo, name: branch.name, htmlUrl },
        Boolean(branch.protected),
      );
      node.description = branch.commit?.id.slice(0, 8);
      node.tooltip = new vscode.MarkdownString(
        [
          `**${branch.name}**${branch.protected ? '（受保护）' : ''}`,
          '',
          `\`${branch.commit?.id.slice(0, 10) ?? '-'}\` ${branch.commit?.message?.split('\n')[0] ?? ''}`,
          '',
          `[在浏览器中打开](${htmlUrl})`,
        ].join('\n'),
      );
      return node;
    });
  }

  /**
   * 加载仓库下打开的 Issue。
   * @param owner 所属者
   * @param repo 仓库名
   * @returns Issue 节点
   */
  private async loadIssues(owner: string, repo: string): Promise<GiteaNode[]> {
    const operations = await this.service.getOperations();
    const result = await operations.issues.list({ owner, repo, state: 'open', type: 'issues', limit: 30 });
    if (result.items.length === 0) {
      return [createMessageNode('没有打开的 Issue。', messageIcons.noIssue)];
    }
    return result.items.map((issue) =>
      createIssueNode(
        issue.title,
        {
          owner,
          repo,
          number: issue.number,
          state: issue.state,
          htmlUrl: issue.html_url,
        },
        (issue.labels ?? []).map((label) => label.name).join(', ') || undefined,
      ),
    );
  }

  /**
   * 加载仓库下打开的 Pull Request。
   * @param owner 所属者
   * @param repo 仓库名
   * @returns PR 节点
   */
  private async loadPulls(owner: string, repo: string): Promise<GiteaNode[]> {
    const operations = await this.service.getOperations();
    const result = await operations.pulls.list({ owner, repo, state: 'open', limit: 30 });
    if (result.items.length === 0) {
      return [createMessageNode('没有打开的 Pull Request。', messageIcons.noPull)];
    }
    return result.items.map((pull) => {
      const payload: PullNodePayload = {
        owner,
        repo,
        number: pull.number,
        state: pull.state,
        htmlUrl: pull.html_url,
        headRef: pull.head?.ref,
        baseRef: pull.base?.ref,
        merged: pull.merged,
        draft: pull.draft,
      };
      return createPullNode(pull.title, payload, pull.draft ? '草稿' : `@${pull.user?.login ?? '-'}`);
    });
  }
}
