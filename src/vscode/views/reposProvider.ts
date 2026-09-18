/**
 * 「仓库」视图：组织分组 → 仓库 → 分支 / 打开的 Issue / 打开的 Pull Request / 工作流。
 *
 * 三种形态：
 *   - **浏览**（默认）：按 owner 分组；含当前工作区仓库的那组置顶并自动展开
 *   - **搜索**：走服务端 `/repos/search`，结果平铺（跨组织，分组反而妨碍扫读）
 *   - **加载更多**：见基类的 `capOf` / `raiseCap`
 */
import * as vscode from 'vscode';
import type { GiteaRepository } from '../../core/types';
import { branchWebUrl, repoWebUrl, runWebUrl, workflowWebUrl } from '../../core/urls';
import { readSettings } from '../config';
import { logWarn } from '../logger';
import type { GiteaService } from '../service';
import { BaseTreeProvider } from './baseProvider';
import { actionIcons, groupIcons, messageIcons } from './icons';
import { repoBadge } from './repoBadge';
import {
  createActionJobNode,
  createActionRunNode,
  createActionWorkflowNode,
  createBranchNode,
  createGroupNode,
  createIssueNode,
  createMessageNode,
  createMoreNode,
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

  /** 当前生效的仓库搜索关键词（由 `gitea.searchRepos` / `gitea.clearRepoSearch` 维护）。 */
  private repoFilter: string | undefined;

  /**
   * 设置仓库搜索关键词并刷新。
   * @param filter 关键词；空串或仅空白表示清除
   */
  public setRepoFilter(filter: string | undefined): void {
    const trimmed = filter?.trim();
    this.repoFilter = trimmed && trimmed.length > 0 ? trimmed : undefined;
    // 供 package.json 的 `when` 使用：只在过滤生效时显示「清除搜索」按钮
    void vscode.commands.executeCommand('setContext', 'gitea.repoFilterActive', this.repoFilter !== undefined);
    this.refresh();
  }

  /** 当前搜索关键词。 */
  public getRepoFilter(): string | undefined {
    return this.repoFilter;
  }

  /** @inheritdoc */
  protected async getRootNodes(): Promise<GiteaNode[]> {
    const operations = await this.service.getOperations();
    const settings = readSettings();
    const filter = this.repoFilter;
    // 搜索与浏览是两套结果集，各自记「加载更多」的上限，否则互相干扰
    const key = filter ? `repos:search:${filter}` : 'repos:mine';
    const limit = this.capOf(key, settings.pageSize);
    const result = filter
      ? await operations.repos.list({ search: filter, limit })
      : await operations.repos.list({ mine: true, limit });

    if (result.items.length === 0) {
      return filter
        ? [
            createMessageNode(
              `没有匹配「${filter}」的仓库。注意 Gitea 只按仓库名 / owner/repo 搜索，不支持只搜组织名`,
              messageIcons.noRepo,
              { command: 'gitea.clearRepoSearch', title: '清除搜索' },
            ),
          ]
        : [
            createMessageNode('当前账号下没有仓库，点击右侧图标新建。', messageIcons.noRepo, {
              command: 'gitea.createRepo',
              title: '新建仓库',
            }),
          ];
    }

    const current = await this.service.getDefaultRepo();
    const currentFullName = current ? `${current.owner}/${current.repo}` : undefined;

    // 搜索结果是跨组织的，平铺更好扫读；按组织分组只在浏览模式有意义
    const nodes = filter
      ? result.items.map((repo) => this.createRepoEntry(repo, currentFullName))
      : this.groupByOwner(result.items, currentFullName);

    // 过滤条件必须看得见，否则「怎么只剩几个仓库」会让人困惑
    if (filter) {
      nodes.unshift(
        createMessageNode(`过滤中：${filter}（点击清除）`, 'search', {
          command: 'gitea.clearRepoSearch',
          title: '清除搜索',
        }),
      );
    }

    if (result.pageInfo.hasNextPage) {
      nodes.push(
        createMoreNode({
          provider: 'repos',
          listKey: key,
          step: settings.pageSize,
          loaded: result.items.length,
        }),
      );
    }
    return nodes;
  }

  /**
   * 按 owner 分组。
   *
   * 排序规则（据此达到「聚焦当前仓库」的效果，且不重复展示同一个仓库）：
   *   1. 含当前工作区仓库的组织**置顶**
   *   2. 其余按仓库数降序，同数量按名称，保证顺序稳定可预期
   * 含当前仓库的那一组**默认展开**，且该仓库在组内排第一 —— 打开工作区即可见。
   * @param repos 仓库列表
   * @param currentFullName 当前工作区对应的仓库全名
   * @returns 组织分组节点
   */
  private groupByOwner(repos: GiteaRepository[], currentFullName?: string): GiteaNode[] {
    const groups = new Map<string, GiteaRepository[]>();
    for (const repo of repos) {
      const owner = this.ownerOf(repo);
      const list = groups.get(owner) ?? [];
      list.push(repo);
      groups.set(owner, list);
    }

    const holdsCurrent = (list: GiteaRepository[]): boolean =>
      currentFullName !== undefined && list.some((repo) => repo.full_name === currentFullName);

    const entries = [...groups.entries()].sort((a, b) => {
      const diff = (holdsCurrent(a[1]) ? 0 : 1) - (holdsCurrent(b[1]) ? 0 : 1);
      if (diff !== 0) {
        return diff;
      }
      if (a[1].length !== b[1].length) {
        return b[1].length - a[1].length;
      }
      return a[0].localeCompare(b[0]);
    });

    return entries.map(([owner, list]) => {
      const ordered = currentFullName
        ? [...list].sort((a, b) =>
            a.full_name === currentFullName ? -1 : b.full_name === currentFullName ? 1 : 0,
          )
        : list;
      return createGroupNode(
        `${owner}（${list.length}）`,
        groupIcons.owners(),
        async () => ordered.map((repo) => this.createRepoEntry(repo, currentFullName)),
        { expanded: holdsCurrent(list) },
      );
    });
  }

  /**
   * 构造单个仓库节点（含铭牌）。
   * @param repo 仓库
   * @param currentFullName 当前工作区对应的仓库全名
   * @returns 节点
   */
  private createRepoEntry(repo: GiteaRepository, currentFullName?: string): GiteaNode {
    const owner = this.ownerOf(repo);
    const node = createRepoNode(
      {
        owner,
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
      () => this.loadRepoChildren(owner, repo.name),
    );
    node.description = repoBadge(repo, currentFullName);
    node.tooltip = new vscode.MarkdownString(
      [
        `**${repo.full_name}**${repo.description ? ` — ${repo.description}` : ''}`,
        '',
        `默认分支：\`${repo.default_branch}\``,
        `开放 Issue：${repo.open_issues_count ?? 0} · 开放 PR：${repo.open_pr_counter ?? 0} · 分支：${repo.branch_count ?? '-'}`,
        `工作流：${repo.has_actions === false ? '未启用' : '已启用'}${repo.language ? ` · 主语言：${repo.language}` : ''}`,
        '',
        repo.has_actions === false
          ? ''
          : '> 这里的「工作流」指 Gitea 的 **Actions 功能是否启用**；「仓库里是否真有 workflow 文件」需要逐个仓库查询，列表不做这一请求。\n',
        `[在浏览器中打开](${repo.html_url})`,
      ]
        .filter((line) => line.length > 0)
        .join('\n'),
    );
    return node;
  }

  /**
   * 取仓库的 owner 名。
   * @param repo 仓库
   * @returns owner 登录名
   */
  private ownerOf(repo: GiteaRepository): string {
    return repo.owner?.login ?? repo.full_name.split('/')[0];
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
      createGroupNode('工作流', actionIcons.runs(), () => this.loadActionGroups(owner, repo)),
    ];
  }

  /**
   * 加载「工作流」下的二级分组。
   *
   * 之所以再分一层而不是直接混排：工作流是「定义」，运行记录是「执行结果」，
   * 混在一起会让「有 3 个工作流、37 次运行」看起来像 40 个同类条目。
   *
   * 内层叫「工作流定义」而非「工作流」：外层已经是「工作流」（界面里叫工作流比 Actions
   * 贴切），同名会让树里出现两级一模一样的标签。
   * @param owner 所属者
   * @param repo 仓库名
   * @returns 分组节点
   */
  private async loadActionGroups(owner: string, repo: string): Promise<GiteaNode[]> {
    return [
      createGroupNode('工作流定义', actionIcons.workflows(), () => this.loadWorkflows(owner, repo)),
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
    const serverUrl = readSettings().serverUrl;

    // **以文件列表为准，API 只用来补「启用状态」。**
    //
    // 因为 Gitea 的 `GET /actions/workflows` **只枚举 `.gitea/workflows`**，忽略
    // `.github/workflows`：实测一个镜像了 GitHub Actions 的仓库（工作流在 `.github/workflows`
    // 下、且有 169 条运行记录）该接口返回 total_count: 0，于是「工作流定义」永远是空的。
    //
    // 一开始写的是「API 为空才回落」，但那会漏掉一个仓库**同时使用两个目录**的情况
    // （API 有返回 → 直接 return → `.github/workflows` 下的看不见）。改成两者都取、
    // 按文件名合并，就不会漏。
    const [apiEntries, files] = await Promise.all([
      // 这个接口在部分实例上不可靠（恒空或直接报错），失败时降级为「没有状态信息」，
      // 不该因为拿不到状态就让整个分组打不开。
      operations.actions.listWorkflows({ owner, repo }).catch((error: unknown) => {
        logWarn('读取工作流列表失败，仅按文件列表展示', error);
        return [] as Awaited<ReturnType<typeof operations.actions.listWorkflows>>;
      }),
      operations.repos.listWorkflowFiles(owner, repo),
    ]);

    // 用**文件名**匹配：`ActionWorkflow.id` 是文件路径（如 `.gitea/workflows/ci.yml`），
    // 而 `name` 是 YAML 里的显示名（如「CI」），两者不能混。
    const apiByFileName = new Map<string, (typeof apiEntries)[number]>();
    for (const entry of apiEntries) {
      apiByFileName.set(entry.id.split('/').pop() ?? entry.id, entry);
    }

    const nodes: GiteaNode[] = [];
    const usedApiIds = new Set<string>();

    for (const file of files) {
      const api = apiByFileName.get(file.name);
      if (api) {
        usedApiIds.add(api.id);
      }
      nodes.push(
        createActionWorkflowNode({
          owner,
          repo,
          workflowId: api?.id ?? file.path,
          // API 的 name 是 YAML 里的显示名，比文件名更好认；没有就用文件名
          name: api?.name ?? file.name,
          // 状态只在 API 给出时才显示，否则交给节点渲染成「状态未知」
          state: api?.state ?? '',
          // 优先用 API 的条目页地址；文件条目用自己的网页地址（contents 接口已带）；
          // 都没有才退回仓库的 Actions 页（够通用但不够精确，仅作兜底）
          htmlUrl:
            api?.html_url || file.htmlUrl || `${repoWebUrl(serverUrl, owner, repo)}/actions`,
        }),
      );
    }

    // API 列出了、但文件列表没覆盖到的（例如工作流定义在其它分支）也补上，避免漏项
    for (const entry of apiEntries) {
      if (usedApiIds.has(entry.id)) {
        continue;
      }
      nodes.push(
        createActionWorkflowNode({
          owner,
          repo,
          workflowId: entry.id,
          name: entry.name,
          state: entry.state,
          htmlUrl: entry.html_url ?? workflowWebUrl(serverUrl, owner, repo, entry.id),
        }),
      );
    }

    if (nodes.length === 0) {
      return [
        createMessageNode(
          '没有配置工作流定义（`.gitea/workflows` 与 `.github/workflows` 下都没有 YAML）。',
          messageIcons.noWorkflow,
        ),
      ];
    }
    return nodes;
  }

  /**
   * 加载最近的运行记录。
   * @param owner 所属者
   * @param repo 仓库名
   * @returns 运行节点
   */
  private async loadActionRuns(owner: string, repo: string): Promise<GiteaNode[]> {
    const operations = await this.service.getOperations();
    const settings = readSettings();
    const key = `actions:${owner}/${repo}`;
    const result = await operations.actions.listRuns({
      owner,
      repo,
      limit: this.capOf(key, settings.pageSize),
    });
    if (result.items.length === 0) {
      return [createMessageNode('没有运行记录。', messageIcons.noRun)];
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
      nodes.push(
        createMoreNode({
          provider: 'repos',
          listKey: key,
          step: settings.pageSize,
          loaded: result.items.length,
        }),
      );
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
    // 不把异常直接抛给树视图：那会弹一句通用的「Gitea 命令失败：资源不存在，或当前令牌
    // 无权访问」，而实际上多半只是这条运行记录已被清理或删除。降级成说明节点，原因写进日志。
    const jobs = await operations.actions.listRunJobs(owner, repo, runId).catch((error: unknown) => {
      logWarn(`读取运行 ${runId} 的作业失败`, error);
      return null;
    });
    if (jobs === null) {
      return [
        createMessageNode(
          '读取该运行的作业失败（记录可能已被清理，详情见「Gitea: 显示日志」）。',
          messageIcons.noRun,
        ),
      ];
    }
    if (jobs.length === 0) {
      return [createMessageNode('该运行暂无作业（可能仍在排队，或运行已被取消）。', messageIcons.noRun)];
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
    const settings = readSettings();
    const key = `branches:${owner}/${repo}`;
    const result = await operations.repos.listBranches(
      owner,
      repo,
      1,
      this.capOf(key, settings.pageSize),
    );
    if (result.items.length === 0) {
      return [createMessageNode('没有分支。', messageIcons.noBranch)];
    }
    const serverUrl = settings.serverUrl;
    const nodes = result.items.map((branch) => {
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
    if (result.pageInfo.hasNextPage) {
      nodes.push(
        createMoreNode({
          provider: 'repos',
          listKey: key,
          step: settings.pageSize,
          loaded: result.items.length,
        }),
      );
    }
    return nodes;
  }

  /**
   * 加载仓库下打开的 Issue。
   * @param owner 所属者
   * @param repo 仓库名
   * @returns Issue 节点
   */
  private async loadIssues(owner: string, repo: string): Promise<GiteaNode[]> {
    const operations = await this.service.getOperations();
    const settings = readSettings();
    const key = `issues:${owner}/${repo}`;
    const result = await operations.issues.list({
      owner,
      repo,
      state: 'open',
      type: 'issues',
      limit: this.capOf(key, settings.pageSize),
    });
    if (result.items.length === 0) {
      return [createMessageNode('没有打开的 Issue。', messageIcons.noIssue)];
    }
    const nodes = result.items.map((issue) =>
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
    if (result.pageInfo.hasNextPage) {
      nodes.push(
        createMoreNode({
          provider: 'repos',
          listKey: key,
          step: settings.pageSize,
          loaded: result.items.length,
        }),
      );
    }
    return nodes;
  }

  /**
   * 加载仓库下打开的 Pull Request。
   * @param owner 所属者
   * @param repo 仓库名
   * @returns PR 节点
   */
  private async loadPulls(owner: string, repo: string): Promise<GiteaNode[]> {
    const operations = await this.service.getOperations();
    const settings = readSettings();
    const key = `pulls:${owner}/${repo}`;
    const result = await operations.pulls.list({
      owner,
      repo,
      state: 'open',
      limit: this.capOf(key, settings.pageSize),
    });
    if (result.items.length === 0) {
      return [createMessageNode('没有打开的 Pull Request。', messageIcons.noPull)];
    }
    const nodes = result.items.map((pull) => {
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
    if (result.pageInfo.hasNextPage) {
      nodes.push(
        createMoreNode({
          provider: 'repos',
          listKey: key,
          step: settings.pageSize,
          loaded: result.items.length,
        }),
      );
    }
    return nodes;
  }
}


