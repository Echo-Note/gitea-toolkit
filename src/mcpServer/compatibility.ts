/**
 * MCP 场景下的 Gitea 服务端版本兼容性提示。
 *
 * 与扩展的 `src/vscode/compatibility.ts` 的分工：那边靠**弹窗**告警（扩展有 UI），
 * 而 MCP 里没有 UI —— **唯一能到达模型的通道就是工具返回**。所以这里不弹窗，
 * 而是把判定结论作为提示**插在工具返回的开头**，模型看到后可以转达给用户
 * （`instructions` 里也写了这句要求）。
 *
 * 三个设计取舍：
 *
 * 1. **只探测一次、只提示一次**：版本在进程生命周期内不会变，重复探测纯属浪费；
 *    而每次调用都重复同一句话既费 token，又会让模型把它当噪音忽略。
 *    同一「等级 + 版本」只提示一次，与扩展侧「同一等级+版本只弹一次」的口径一致。
 * 2. **探测失败不影响工具本身**：拿不到版本时安静跳过（只在 stderr 留一行），
 *    绝不因为「查不到版本」就让工具调用失败。
 * 3. **措辞在这里重写，而不是直接用 core 的 message**：核心模块的文案是给**扩展用户**
 *    看的（「本扩展已核对 …」），放进 MCP 返回里会说不通。所以这里只用它的判定结果
 *    （level / actual / verified）自行组织措辞 —— Python 版有逐字相同的对应实现。
 */
import {
  evaluateCompatibility,
  VERIFIED_GITEA_VERSION,
  MIN_SUPPORTED_GITEA_VERSION,
  type CompatibilityResult,
} from '../core/version';

/** 提示开头：明确要求模型转达，否则模型很可能只当成背景信息。 */
const NOTICE_HEAD = '⚠️ **服务端 Gitea 版本兼容性提示 —— 请转达给用户**：';

/** 提示结尾：给出「随时复查」的入口，并说明只出现一次（免得模型以为漏了什么）。 */
const NOTICE_TAIL = '（该提示每个会话只出现一次；可用 `gitea_get_current_user` 复查服务端版本。）';

/**
 * 把判定结果组织成给模型的提示。
 * @param result 兼容性判定结果
 * @returns 一段 Markdown 提示（多行）
 */
export function compatibilityNotice(result: CompatibilityResult): string {
  const detail = (() => {
    switch (result.level) {
      case 'unsupported':
        return (
          `服务端为 ${result.actual}，低于本 MCP 要求的最低版本 ${MIN_SUPPORTED_GITEA_VERSION}。` +
          '部分接口可能不存在或语义不同，工具调用可能失败 —— **建议用户升级 Gitea 服务端**。'
        );
      case 'older':
        return (
          `服务端为 ${result.actual}，低于本 MCP 已核对的 ${VERIFIED_GITEA_VERSION}。` +
          '较新版本引入的部分能力可能不可用（例如 PR 的分支引用字段、通知的批量状态），工具行为可能受限。'
        );
      case 'newer':
        return (
          `服务端为 ${result.actual}，高于本 MCP 已核对的 ${VERIFIED_GITEA_VERSION}。` +
          '接口可能已发生变化，若出现异常请用户反馈。'
        );
      default:
        return (
          `无法识别服务端返回的版本号（原文：${result.actual}）。` +
          `本 MCP 的接口以 Gitea ${VERIFIED_GITEA_VERSION} 为准核对，请用户自行确认兼容性。`
        );
    }
  })();

  return `${NOTICE_HEAD}${detail}\n${NOTICE_TAIL}`;
}

/** 兼容性监测器。 */
export class CompatibilityMonitor {
  /** 已完成的判定结果；探测成功前为 undefined。 */
  private result?: CompatibilityResult;

  /** 进行中的探测，保证并发调用只发一次请求。 */
  private probing?: Promise<CompatibilityResult | undefined>;

  /** 已提示过的「等级 + 版本」，用于去重。 */
  private announced?: string;

  /**
   * @param getVersion 读取服务端版本原文（通常是 `misc.getVersion()`）
   * @param log stderr 日志（由调用方注入，保持前缀一致）
   */
  constructor(
    private readonly getVersion: () => Promise<string>,
    private readonly log: (message: string, detail?: unknown) => void,
  ) {}

  /**
   * 取判定结果（带缓存）。
   *
   * 失败时返回 undefined 并记录日志 —— **不抛异常**：版本探测是「锦上添花」，
   * 绝不能因为它失败而让工具调用挂掉。
   * @returns 判定结果
   */
  public async evaluate(): Promise<CompatibilityResult | undefined> {
    if (this.result !== undefined) {
      return this.result;
    }
    if (this.probing === undefined) {
      this.probing = this.getVersion()
        .then((raw) => {
          const result = evaluateCompatibility(raw);
          this.result = result;
          this.log(
            `服务端 Gitea 版本 ${result.actual} → 兼容性 ${result.level}（已核对 ${result.verified}）`,
          );
          return result;
        })
        .catch((error: unknown) => {
          this.log('读取服务端版本失败，跳过兼容性检查', error);
          return undefined;
        });
    }
    return this.probing;
  }

  /**
   * 取「本次需要插进工具返回」的提示。
   *
   * 兼容或已提示过时返回空串。
   * @returns 提示文本（可能为空）
   */
  public async takeNotice(): Promise<string> {
    const result = await this.evaluate();
    if (!result || !result.shouldWarn) {
      return '';
    }
    const key = `${result.level}:${result.actual}`;
    if (this.announced === key) {
      return '';
    }
    this.announced = key;
    return `${compatibilityNotice(result)}\n\n`;
  }
}
