/**
 * 「仓库」视图：仓库列表 → 分支 / 打开的 Issue / 打开的 Pull Request。
 */
import * as vscode from 'vscode';
import { branchWebUrl } from '../../core/urls';
import { readSettings } from '../config';
import type { GiteaService } from '../service';
import { BaseTreeProvider } from './baseProvider';
import { groupIcons, messageIcons } from './icons';
import {
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
    ];
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
