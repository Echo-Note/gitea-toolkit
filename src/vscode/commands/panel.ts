/**
 * 详情面板依赖装配。
 *
 * 把命令层的依赖转换为面板所需的形式，并统一「写操作成功后刷新侧边栏」的行为。
 */
import type { DetailPanelDeps } from '../views/detail/detailPanel';
import type { CommandDeps } from './types';

/**
 * 构造详情面板依赖。
 * @param deps 命令依赖
 * @returns 面板依赖
 */
export function buildPanelDeps(deps: CommandDeps): DetailPanelDeps {
  return {
    context: deps.context,
    service: deps.service,
    onDidMutate: () => {
      for (const provider of Object.values(deps.providers)) {
        provider.refresh();
      }
    },
  };
}
