/**
 * 扩展自身更新的纯计算部分。
 *
 * 与 {@link ../vscode/updateChecker} 的分工，同 {@link ./version} 与 compatibility 的关系一致：
 * 这里只做「版本号 → 判定结果」的纯计算，不碰网络、不碰 UI，便于单独验证。
 *
 * 为什么不复用 {@link ./version} 里的解析：那套是针对 Gitea 服务端版本的（只看 major.minor，
 * 且忽略预发布标识）。扩展自身用的是语义化版本，`0.1.10` 必须大于 `0.1.9`、
 * `0.2.0-rc.1` 必须小于 `0.2.0`，两者的语义不同，不能混用。
 */

/** 解析后的语义化版本。 */
export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  /** 预发布标识（如 `rc.1`）；稳定版为 undefined。 */
  prerelease?: string;
  /** 原始字符串。 */
  raw: string;
}

/** 更新判定结果。 */
export interface UpdateEvaluation {
  /** 当前版本（规范化后的文本）。 */
  current: string;
  /** 远端最新版本（规范化后的文本）。 */
  latest: string;
  /** 远端是否比当前新。 */
  hasUpdate: boolean;
}

/**
 * 解析语义化版本号。
 *
 * 容错处理常见变体（tag 常带前缀或后缀）：
 * `v0.1.5`、`0.1`（补全为 `0.1.0`）、`0.2.0-rc.1`、`0.2.0+build.7`（构建元数据不参与比较）。
 * @param raw 原始版本字符串
 * @returns 解析结果；无法解析时返回 undefined
 */
export function parseSemver(raw: string | undefined | null): ParsedSemver | undefined {
  if (!raw || typeof raw !== 'string') {
    return undefined;
  }
  const text = raw.trim().replace(/^v/i, '');
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text);
  if (!match) {
    return undefined;
  }
  return {
    major: Number.parseInt(match[1], 10),
    minor: match[2] ? Number.parseInt(match[2], 10) : 0,
    patch: match[3] ? Number.parseInt(match[3], 10) : 0,
    prerelease: match[4],
    raw: raw.trim(),
  };
}

/**
 * 比较两个语义化版本，遵循 semver 的优先级规则。
 * @param a 版本 a
 * @param b 版本 b
 * @returns a &gt; b 返回正数，相等返回 0，a &lt; b 返回负数
 */
export function compareSemver(a: ParsedSemver, b: ParsedSemver): number {
  if (a.major !== b.major) {
    return a.major - b.major;
  }
  if (a.minor !== b.minor) {
    return a.minor - b.minor;
  }
  if (a.patch !== b.patch) {
    return a.patch - b.patch;
  }
  // 按 semver：带预发布标识的版本优先级**低于**同号稳定版（0.2.0-rc.1 < 0.2.0）
  if (a.prerelease === b.prerelease) {
    return 0;
  }
  if (a.prerelease === undefined) {
    return 1;
  }
  if (b.prerelease === undefined) {
    return -1;
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}

/**
 * 规范化输出为 `major.minor.patch[-prerelease]`。
 * @param version 解析后的版本
 * @returns 版本字符串
 */
export function formatSemver(version: ParsedSemver): string {
  const base = `${version.major}.${version.minor}.${version.patch}`;
  return version.prerelease ? `${base}-${version.prerelease}` : base;
}

/**
 * 判定是否存在可用更新。
 * @param currentRaw 当前版本
 * @param latestRaw 远端最新版本（可带 `v` 前缀）
 * @returns 判定结果；任一版本无法解析时返回 undefined
 */
export function evaluateUpdate(currentRaw: string, latestRaw: string): UpdateEvaluation | undefined {
  const current = parseSemver(currentRaw);
  const latest = parseSemver(latestRaw);
  if (!current || !latest) {
    return undefined;
  }
  return {
    current: formatSemver(current),
    latest: formatSemver(latest),
    hasUpdate: compareSemver(latest, current) > 0,
  };
}

/**
 * 比较预发布标识段（semver 规则：逐段比较，数字段按数值、字母段按字典序，
 * 数字段的优先级低于字母段；段数少的一方优先级更低）。
 * @param a 预发布标识 a
 * @param b 预发布标识 b
 * @returns 比较结果
 */
function comparePrerelease(a: string, b: string): number {
  const left = a.split('.');
  const right = b.split('.');
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const x = left[index];
    const y = right[index];
    if (x === undefined) {
      return -1;
    }
    if (y === undefined) {
      return 1;
    }
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) {
      const diff = Number.parseInt(x, 10) - Number.parseInt(y, 10);
      if (diff !== 0) {
        return diff;
      }
      continue;
    }
    if (xNumeric !== yNumeric) {
      return xNumeric ? -1 : 1;
    }
    if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}
