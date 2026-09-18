/**
 * 仓库节点右侧「铭牌」的文本生成。
 *
 * 与 `icons.ts` 同样的理由，本文件**刻意不依赖 `vscode` 模块**：这样它既能在扩展宿主里用，
 * 也能被脚本单独打包、用真实数据离线渲染预览（引了 `vscode` 就只能在宿主里跑）。
 *
 * 设计约束：**只用列表接口已经返回的字段，不产生任何额外请求**。
 * 因此这里给出的是 `has_actions`（Actions **功能开关**）而不是「仓库里是否真有 workflow 文件」——
 * 后者必须逐个仓库调 `/actions/workflows`，上百个仓库就是上百次请求，不能放在列表渲染路径上。
 */
import type { GiteaRepository } from '../../core/types';

/**
 * 生成仓库节点的铭牌文本。
 *
 * 计数为 0 的一律不显示：实测本项目实例里绝大多数仓库的开放 Issue / PR 都是 0，
 * 全部显示只会让右侧变成噪音。
 * @param repo 仓库
 * @param currentFullName 当前工作区对应的仓库全名（用于标出「★ 当前」）
 * @returns 铭牌文本，各段以 ` · ` 相连；无内容时返回空串
 */
export function repoBadge(repo: GiteaRepository, currentFullName?: string): string {
  const parts: string[] = [];

  // 1) 需要一眼看到的「异常/定位」信息放最前，避免被右侧截断掉
  if (currentFullName !== undefined && repo.full_name === currentFullName) {
    parts.push('★ 当前');
  }
  if (repo.archived) {
    parts.push('已归档');
  }
  if (repo.has_actions === false) {
    parts.push('工作流未启用');
  }

  // 2) 容易分辨仓库的固有属性
  if (repo.language) {
    parts.push(repo.language);
  }

  // 3) 计数
  if (repo.branch_count !== undefined) {
    parts.push(`${repo.branch_count} 分支`);
  }
  if ((repo.open_issues_count ?? 0) > 0) {
    parts.push(`${repo.open_issues_count} Issue`);
  }
  if ((repo.open_pr_counter ?? 0) > 0) {
    parts.push(`${repo.open_pr_counter} PR`);
  }

  return parts.join(' · ');
}
