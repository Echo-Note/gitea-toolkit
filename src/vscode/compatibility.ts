/**
 * Gitea 版本兼容性检查的交互编排。
 *
 * 与 {@link ../core/version} 的分工：核心模块只做「版本号 → 判定结果」的纯计算，
 * 这里负责取版本、决定是否弹窗、记录「已提示」状态，避免同一版本反复打扰用户。
 */
import * as vscode from 'vscode';
import { evaluateCompatibility, VERIFIED_GITEA_VERSION, type CompatibilityLevel, type CompatibilityResult } from '../core/version';
import { logInfo, logWarn, showLog } from './logger';
import type { GiteaService } from './service';

/** 记录「已告警过的版本」的 globalState 键。 */
const WARNED_STATE_KEY = 'gitea.compatibilityWarnedVersion';

/** 版本检查选项。 */
export interface CompatibilityCheckOptions {
  /** 忽略「已提示过同版本」的记录，强制重新弹窗。 */
  force?: boolean;
  /** 已知的服务端版本号，传入可省去一次 `/version` 请求。 */
  actualVersion?: string;
}

/**
 * 检查服务端 Gitea 版本并在不匹配时弹窗告警。
 *
 * @param context 扩展上下文（用于持久化「已提示」记录）
 * @param service Gitea 服务
 * @param options 检查选项
 * @returns 判定结果；取版本失败时返回 undefined
 */
export async function verifyCompatibility(
  context: vscode.ExtensionContext,
  service: GiteaService,
  options: CompatibilityCheckOptions = {},
): Promise<CompatibilityResult | undefined> {
  let actualVersion = options.actualVersion;
  if (actualVersion === undefined) {
    try {
      actualVersion = (await service.getGiteaVersion(!options.force)).version;
    } catch (error) {
      logWarn('读取 Gitea 版本失败，跳过兼容性检查', error);
      return undefined;
    }
  }

  const result = evaluateCompatibility(actualVersion);
  logInfo(
    `版本兼容性判定：${result.level}（服务端 ${result.actual} / 已核对 ${result.verified}）`,
  );

  if (!result.shouldWarn) {
    await clearWarningState(context);
    return result;
  }

  const stateKey = `${result.level}:${result.actual}`;
  if (!options.force && context.globalState.get<string>(WARNED_STATE_KEY) === stateKey) {
    return result;
  }

  const actions = result.level === 'unsupported' ? ['查看日志', '我知道了'] : ['我知道了'];
  const picked = await vscode.window.showWarningMessage(
    warningTitle(result.level),
    { modal: true, detail: result.message },
    ...actions,
  );
  if (picked === '查看日志') {
    showLog();
  }

  await context.globalState.update(WARNED_STATE_KEY, stateKey);
  return result;
}

/**
 * 以非阻塞方式展示当前兼容性状态（用于「显示当前登录用户」等主动查询场景）。
 * @param result 判定结果
 */
export function describeCompatibility(result: CompatibilityResult): string {
  const prefix = result.level === 'ok' ? '✅' : '⚠️';
  return `${prefix} Gitea ${result.actual}（扩展已核对 ${VERIFIED_GITEA_VERSION}）`;
}

/**
 * 清除「已提示」记录，使下一次登录重新告警。
 * @param context 扩展上下文
 */
export async function clearWarningState(context: vscode.ExtensionContext): Promise<void> {
  const current = context.globalState.get<string>(WARNED_STATE_KEY);
  if (current !== undefined) {
    await context.globalState.update(WARNED_STATE_KEY, undefined);
  }
}

/**
 * 依据等级生成弹窗标题。
 * @param level 兼容性等级
 * @returns 中文标题
 */
function warningTitle(level: CompatibilityLevel): string {
  switch (level) {
    case 'unsupported':
      return 'Gitea 版本过低，功能可能异常';
    case 'newer':
      return 'Gitea 版本高于扩展已核对的版本';
    case 'older':
      return 'Gitea 版本低于扩展已核对的版本';
    default:
      return '无法识别 Gitea 版本';
  }
}
