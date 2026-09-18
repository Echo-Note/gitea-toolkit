/**
 * Gitea 服务端版本解析与兼容性判定。
 *
 * 本模块不依赖 VS Code，扩展宿主与 MCP Server 均可复用。
 */

/**
 * 扩展**已逐项核对过**的 Gitea 版本。
 *
 * 含义：`src/core/operations/` 下所有端点的路径、参数与响应字段，
 * 都以该版本的 OpenAPI 规范（`https://<host>/swagger.v1.json`）为准核对过。
 * 服务端版本与此不一致时应提示用户"未经核对"。
 */
export const VERIFIED_GITEA_VERSION = '1.26.4';

/**
 * 扩展可运行的**最低** Gitea 版本。
 *
 * 选择理由：1.21 是 Gitea 的 LTS 分支，本扩展用到的全部端点
 * （`/repos/issues/search`、`/repos/{owner}/{repo}/pulls/{index}.diff`、
 * `POST /markdown`、`PUT /notifications`、`repoCreatePullReview` 等）
 * 在该版本均已可用且语义一致；更早版本未经验证。
 */
export const MIN_SUPPORTED_GITEA_VERSION = '1.21.0';

/** 解析后的版本号。 */
export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** 原始版本字符串。 */
  raw: string;
}

/** 兼容性等级。 */
export type CompatibilityLevel =
  /** 主次版本与已核对版本一致。 */
  | 'ok'
  /** 比已核对版本新（可能已发生接口变更）。 */
  | 'newer'
  /** 比已核对版本旧，但仍在最低支持版本之上。 */
  | 'older'
  /** 低于最低支持版本。 */
  | 'unsupported'
  /** 无法解析版本号。 */
  | 'unknown';

/** 兼容性判定结果。 */
export interface CompatibilityResult {
  /** 等级。 */
  level: CompatibilityLevel;
  /** 服务端实际版本原文。 */
  actual: string;
  /** 扩展已核对的版本。 */
  verified: string;
  /** 面向用户的中文说明（可直接用于弹窗）。 */
  message: string;
  /** 是否需要向用户告警。 */
  shouldWarn: boolean;
}

/**
 * 解析 Gitea 版本字符串。
 *
 * 容错处理常见变体：`1.26.4`、`v1.26.4`、`1.26.4+dev`、`1.22.0-rc1`、
 * `1.26.4 (git: abcdef)`、`1.26`。
 * @param raw 原始版本字符串
 * @returns 解析结果；无法解析时返回 undefined
 */
export function parseGiteaVersion(raw: string | undefined | null): ParsedVersion | undefined {
  if (!raw || typeof raw !== 'string') {
    return undefined;
  }
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(raw.trim());
  if (!match) {
    return undefined;
  }
  const [, major, minor, patch] = match;
  return {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    patch: patch ? Number.parseInt(patch, 10) : 0,
    raw: raw.trim(),
  };
}

/**
 * 比较两个版本号。
 * @param a 版本 a
 * @param b 版本 b
 * @returns a &gt; b 返回正数，相等返回 0，a &lt; b 返回负数
 */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) {
    return a.major - b.major;
  }
  if (a.minor !== b.minor) {
    return a.minor - b.minor;
  }
  return a.patch - b.patch;
}

/**
 * 格式化版本号为 `major.minor.patch`。
 * @param version 解析后的版本
 * @returns 版本字符串
 */
export function formatVersion(version: ParsedVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

/**
 * 判定服务端版本与扩展的兼容性。
 *
 * 判定只看主次版本：同一 `major.minor` 下的补丁差异视为兼容（Gitea 补丁版本不做破坏性变更）。
 * @param rawVersion `/version` 接口返回的版本字符串
 * @returns 判定结果
 */
export function evaluateCompatibility(rawVersion: string | undefined | null): CompatibilityResult {
  const actual = parseGiteaVersion(rawVersion);
  const verified = parseGiteaVersion(VERIFIED_GITEA_VERSION) as ParsedVersion;
  const minSupported = parseGiteaVersion(MIN_SUPPORTED_GITEA_VERSION) as ParsedVersion;
  const rawText = (rawVersion ?? '').trim();

  if (!actual) {
    return {
      level: 'unknown',
      actual: rawText || '（未返回）',
      verified: VERIFIED_GITEA_VERSION,
      message:
        `无法识别服务端返回的 Gitea 版本号：${rawText || '（空）'}。\n\n` +
        `本扩展的接口调用以 Gitea ${VERIFIED_GITEA_VERSION} 为准核对，请自行确认兼容性。`,
      shouldWarn: true,
    };
  }

  if (compareVersions(actual, minSupported) < 0) {
    return {
      level: 'unsupported',
      actual: formatVersion(actual),
      verified: VERIFIED_GITEA_VERSION,
      message:
        `服务端 Gitea 版本为 ${formatVersion(actual)}，低于本扩展要求的最低版本 ${MIN_SUPPORTED_GITEA_VERSION}。\n\n` +
        `部分接口可能不存在或语义不同，功能可能异常。建议升级 Gitea 服务端。`,
      shouldWarn: true,
    };
  }

  if (actual.major === verified.major && actual.minor === verified.minor) {
    return {
      level: 'ok',
      actual: formatVersion(actual),
      verified: VERIFIED_GITEA_VERSION,
      message: `Gitea ${formatVersion(actual)} 与本扩展已核对的版本一致。`,
      shouldWarn: false,
    };
  }

  const isNewer = actual.major > verified.major || (actual.major === verified.major && actual.minor > verified.minor);
  if (isNewer) {
    return {
      level: 'newer',
      actual: formatVersion(actual),
      verified: VERIFIED_GITEA_VERSION,
      message:
        `服务端 Gitea 版本为 ${formatVersion(actual)}，高于本扩展已核对的 ${VERIFIED_GITEA_VERSION}。\n\n` +
        '接口可能已发生变化，若出现功能异常请反馈。',
      shouldWarn: true,
    };
  }

  return {
    level: 'older',
    actual: formatVersion(actual),
    verified: VERIFIED_GITEA_VERSION,
    message:
      `服务端 Gitea 版本为 ${formatVersion(actual)}，低于本扩展已核对的 ${VERIFIED_GITEA_VERSION}。\n\n` +
      '较新版本引入的部分接口能力可能不可用（例如 PR 分支引用字段、通知批量状态等），功能可能受限。',
    shouldWarn: true,
  };
}

/**
 * 兼容性状态的一行摘要（供状态栏、工具返回等「随手指带一句」的场景）。
 *
 * 措辞**刻意保持中性**（不写「本扩展」/「本 MCP」）：核心模块同时被扩展宿主与 MCP Server
 * 使用，写死任一侧都会在另一侧说不通。两侧各自的完整说明见 `src/vscode/compatibility.ts`
 * 与 `src/mcpServer/compatibility.ts`。
 * @param result 判定结果；未取到时传 undefined
 * @returns 形如 `1.26.4｜兼容性 ok（已核对 1.26.4）`
 */
export function compatibilityStatusLine(result: CompatibilityResult | undefined): string {
  if (!result) {
    return '（读取失败，不影响本次调用）';
  }
  return `${result.actual}｜兼容性 \`${result.level}\`（已核对 ${result.verified}）`;
}
