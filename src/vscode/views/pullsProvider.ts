/**
 * 「我的 Pull Request」视图：按「待我评审 / 我创建的 / 全部打开」分组展示。
 */
import { readSettings } from '../config';
import type { GiteaService } from '../service';
import { BaseTreeProvider } from './baseProvider';
import { pullGroupIcons, type IconSpec } from './icons';
import { createGroupNode, createMessageNode, createPullNode, GiteaNode, type PullNodePayload } from './nodes';

/** 分组定义。 */
interface PullGroup {
  label: string;
  /** 分组图标（带状态色），同时用于空分组提示。 */
  iconPath: () => IconSpec;
  query: { reviewRequestedMe?: boolean; createdByMe?: boolean };
}

/** 预定义分组。 */
const GROUPS: PullGroup[] = [
  { label: '待我评审', iconPath: pullGroupIcons.reviewRequested, query: { reviewRequestedMe: true } },
  { label: '我创建的', iconPath: pullGroupIcons.created, query: { createdByMe: true } },
  { label: '全部打开', iconPath: pullGroupIcons.all, query: {} },
];

/** 「我的 Pull Request」树视图提供者。 */
export class PullsProvider extends BaseTreeProvider {
  constructor(service: GiteaService) {
    super(service);
  }

  /** @inheritdoc */
  protected async getRootNodes(): Promise<GiteaNode[]> {
    await this.service.getOperations();
    return GROUPS.map((group) => createGroupNode(group.label, group.iconPath(), () => this.loadGroup(group)));
  }

  /**
   * 加载单个分组下的 PR。
   * @param group 分组定义
   * @returns PR 节点
   */
  private async loadGroup(group: PullGroup): Promise<GiteaNode[]> {
    const operations = await this.service.getOperations();
    const settings = readSettings();
    const result = await operations.issues.list({
      ...group.query,
      state: 'open',
      type: 'pulls',
      limit: settings.pageSize,
    });

    if (result.items.length === 0) {
      return [createMessageNode('没有匹配的 Pull Request。', group.iconPath().id)];
    }
    return result.items.map((issue) => {
      const owner = issue.repository?.owner?.login ?? issue.repository?.full_name.split('/')[0] ?? '';
      const repo = issue.repository?.name ?? '';
      const payload: PullNodePayload = {
        owner,
        repo,
        number: issue.number,
        state: issue.state,
        htmlUrl: issue.html_url,
        headRef: undefined,
        baseRef: undefined,
        merged: issue.pull_request?.merged,
      };
      return createPullNode(issue.title, payload, `${owner}/${repo}`);
    });
  }
}
