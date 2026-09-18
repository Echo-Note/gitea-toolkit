/**
 * 「我的 Issue」视图：按「分配给我 / 我创建的 / 提及我的」分组展示。
 */
import { readSettings } from '../config';
import type { GiteaService } from '../service';
import { BaseTreeProvider } from './baseProvider';
import { issueGroupIcons, type IconSpec } from './icons';
import {
  createGroupNode,
  createIssueNode,
  createMessageNode,
  createMoreNode,
  GiteaNode,
} from './nodes';

/** 分组定义。 */
interface IssueGroup {
  label: string;
  /** 分组图标（带状态色），同时用于空分组提示。 */
  iconPath: () => IconSpec;
  query: { assignedToMe?: boolean; createdByMe?: boolean; mentionedMe?: boolean };
}

/** 预定义分组。 */
const GROUPS: IssueGroup[] = [
  { label: '分配给我', iconPath: issueGroupIcons.assigned, query: { assignedToMe: true } },
  { label: '我创建的', iconPath: issueGroupIcons.created, query: { createdByMe: true } },
  { label: '提及我的', iconPath: issueGroupIcons.mentioned, query: { mentionedMe: true } },
];

/** 「我的 Issue」树视图提供者。 */
export class IssuesProvider extends BaseTreeProvider {
  constructor(service: GiteaService) {
    super(service);
  }

  /** @inheritdoc */
  protected async getRootNodes(): Promise<GiteaNode[]> {
    // 提前触发一次调用以验证配置与令牌，避免每个分组各自报错。
    await this.service.getOperations();
    return GROUPS.map((group) => createGroupNode(group.label, group.iconPath(), () => this.loadGroup(group)));
  }

  /**
   * 加载单个分组下的 Issue。
   * @param group 分组定义
   * @returns Issue 节点
   */
  private async loadGroup(group: IssueGroup): Promise<GiteaNode[]> {
    const operations = await this.service.getOperations();
    const settings = readSettings();
    const key = `issue-group:${group.label}`;
    const result = await operations.issues.list({
      ...group.query,
      state: 'open',
      type: 'issues',
      limit: this.capOf(key, settings.pageSize),
    });

    if (result.items.length === 0) {
      return [createMessageNode('没有匹配的 Issue。', group.iconPath().id)];
    }
    const nodes = result.items.map((issue) => {
      const owner = issue.repository?.owner?.login ?? issue.repository?.full_name.split('/')[0] ?? '';
      const repo = issue.repository?.name ?? '';
      return createIssueNode(
        issue.title,
        {
          owner,
          repo,
          number: issue.number,
          state: issue.state,
          htmlUrl: issue.html_url,
        },
        `${owner}/${repo}`,
      );
    });
    if (result.pageInfo.hasNextPage) {
      nodes.push(
        createMoreNode({
          provider: 'issues',
          listKey: key,
          step: settings.pageSize,
          loaded: result.items.length,
        }),
      );
    }
    return nodes;
    }
}
