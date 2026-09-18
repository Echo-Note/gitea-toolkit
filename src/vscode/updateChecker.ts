/**
 * 扩展自身的更新检查。
 *
 * 本扩展经 GitHub Releases 分发（未发布到 Marketplace），编辑器**不会自动更新**，
 * 因此需要主动查询 Release 是否有新版本。
 *
 * 设计上刻意保守：
 *   - 自动检查**每天最多一次**，避免打满 GitHub 匿名 API 的限额（60 次/小时/IP）
 *   - 「已检查时间」只在**请求成功**后写入，失败不占用当天的额度
 *   - 同一个新版本只提示一次
 *   - 任何网络 / 解析失败都只写日志，除手动触发外不打扰用户
 *   - TLS 校验恒定开启，**不继承** `gitea.verifyTls`（那是给内网自签名 Gitea 实例用的）
 */
import * as https from 'node:https';
import * as vscode from 'vscode';
import { evaluateUpdate } from '../core/selfUpdate';
import { buildUserAgent, readSettings } from './config';
import { logInfo, logWarn } from './logger';

/**
 * 分发渠道。
 *
 * - `'github'`：仅经 GitHub Releases 分发。编辑器不会自动更新，故启用内置更新检查。
 * - `'marketplace'`：已上架扩展市场（当前为 Open VSX，CodeBuddy 的扩展源），
 *   **编辑器会自动更新**。此时关闭自动检查 —— 否则若 GitHub Releases 领先于市场
 *   （CI 每次版本递增都发 Release，而市场发布也可能是手动的），用户会被反复提示
 *   「去 GitHub 下载 .vsix」，绕过市场，两条通道互相打架。
 *
 * 之所以用编译期常量而不是运行时探测：VS Code 没有公开 API 能判断扩展的安装来源，
 * 三种安装方式（市场 / VSIX / 开发）落在同一个 `extensions/` 目录下，无法区分。
 *
 * 2026-09-18 改为 `'marketplace'`：`echo-note.gitea-toolkit` 已在 Open VSX 上架。
 * 手动检查（`Gitea: 检查更新`）不受影响，仍可用，只是结果里会注明比对的是 GitHub Releases。
 */
export const UPDATE_CHANNEL: 'github' | 'marketplace' = 'marketplace';

/** globalState 键：上次成功检查的时间戳。 */
const LAST_CHECK_KEY = 'gitea.update.lastCheckAt';

/** globalState 键：上次已提示过的版本。 */
const NOTIFIED_KEY = 'gitea.update.notifiedVersion';

/** 自动检查的最小间隔（24 小时）。 */
const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** 请求超时（毫秒）。 */
const REQUEST_TIMEOUT_MS = 8_000;

/** GitHub Release 中我们关心的字段。 */
interface GithubRelease {
  tag_name?: string;
  html_url?: string;
  body?: string;
  prerelease?: boolean;
  draft?: boolean;
  assets?: Array<{ name?: string; browser_download_url?: string; size?: number }>;
}

/** 更新检查结果。 */
export interface UpdateInfo {
  /** 当前版本。 */
  current: string;
  /** 远端最新版本。 */
  latest: string;
  /** 是否有可用更新。 */
  hasUpdate: boolean;
  /** Release 页面地址。 */
  releaseUrl: string;
  /** `.vsix` 直链。 */
  downloadUrl?: string;
  /** `SHA256SUMS` 直链。 */
  checksumUrl?: string;
  /** Release 说明正文。 */
  notes?: string;
}

/**
 * 检查是否有新版本。
 * @param context 扩展上下文
 * @param options 检查选项
 * @returns 检查结果；无法判定时返回 undefined
 */
export async function checkForUpdates(
  context: vscode.ExtensionContext,
  options: { manual?: boolean } = {},
): Promise<UpdateInfo | undefined> {
  const slug = resolveRepoSlug(context);
  if (!slug) {
    logWarn('package.json 未声明可解析的 repository，无法检查更新');
    if (options.manual) {
      void vscode.window.showWarningMessage(
        '无法检查更新：扩展清单里没有可解析的 repository 字段。',
      );
    }
    return undefined;
  }

  let release: GithubRelease;
  try {
    release = await fetchLatestRelease(slug, buildUserAgent(context));
  } catch (error) {
    logWarn('检查扩展更新失败', error);
    if (options.manual) {
      void vscode.window.showWarningMessage(`检查更新失败：${(error as Error).message}`);
    }
    return undefined;
  }

  if (release.draft || release.prerelease) {
    // `/releases/latest` 本就不会返回草稿与预发布，这里是防御性判断
    logInfo('最新 Release 是草稿或预发布版本，跳过更新提示');
    return undefined;
  }

  const highlightedVersion = release.tag_name;
  if (!highlightedVersion) {
    if (options.manual) {
      void vscode.window.showWarningMessage('检查更新失败：Release 未提供版本号。');
    }
    return undefined;
  }

  const current = extensionVersion(context);
  const evaluation = evaluateUpdate(current, highlightedVersion);
  if (!evaluation) {
    logWarn(`无法解析版本号：当前 ${current} / 远端 ${highlightedVersion}`);
    if (options.manual) {
      void vscode.window.showWarningMessage(
        `无法比较版本号：当前 ${current}，远端 ${highlightedVersion}。`,
      );
    }
    return undefined;
  }

  const assets = release.assets ?? [];
  const vsix = assets.find((asset) => asset.name?.toLowerCase().endsWith('.vsix'));
  const checksums = assets.find((asset) => asset.name === 'SHA256SUMS');

  return {
    current: evaluation.current,
    latest: evaluation.latest,
    hasUpdate: evaluation.hasUpdate,
    releaseUrl: release.html_url ?? `https://github.com/${slug}/releases/latest`,
    downloadUrl: vsix?.browser_download_url,
    checksumUrl: checksums?.browser_download_url,
    notes: release.body?.trim() || undefined,
  };
}

/**
 * 激活时的自动检查：每天最多一次，同一新版本只提示一次。
 * @param context 扩展上下文
 */
export async function autoCheckForUpdates(context: vscode.ExtensionContext): Promise<void> {
  if (UPDATE_CHANNEL !== 'github') {
    // 已上架 Marketplace：交给编辑器的自动更新，内置检查只会造成重复或矛盾提示
    return;
  }
  if (!readSettings().checkUpdates) {
    return;
  }
  const lastCheckAt = context.globalState.get<number>(LAST_CHECK_KEY, 0);
  if (Date.now() - lastCheckAt < AUTO_CHECK_INTERVAL_MS) {
    return;
  }

  const info = await checkForUpdates(context);
  if (!info) {
    // 失败不记录时间戳，下个窗口启动时还会再试，避免一次网络抖动白等一天
    return;
  }
  await context.globalState.update(LAST_CHECK_KEY, Date.now());

  if (!info.hasUpdate || context.globalState.get<string>(NOTIFIED_KEY) === info.latest) {
    return;
  }
  await context.globalState.update(NOTIFIED_KEY, info.latest);
  await showUpdatePrompt(info);
}

/**
 * 弹出更新提示。
 * @param info 更新信息
 */
export async function showUpdatePrompt(info: UpdateInfo): Promise<void> {
  const picked = await vscode.window.showInformationMessage(
    `Gitea Toolkit 有新版本 ${info.latest}（当前 ${info.current}）`,
    '下载 .vsix',
    '查看变更',
    '不再提醒',
  );

  if (picked === '下载 .vsix') {
    await vscode.env.openExternal(vscode.Uri.parse(info.downloadUrl ?? info.releaseUrl));
    if (info.checksumUrl) {
      // 承接 Release 里发布的 SHA256SUMS：核对「下载到的就是 CI 产出的那一份」
      const hint = await vscode.window.showInformationMessage(
        '下载完成后可用发布件旁的 SHA256SUMS 核对文件与 CI 产出一致。',
        '打开 SHA256SUMS',
      );
      if (hint === '打开 SHA256SUMS') {
        await vscode.env.openExternal(vscode.Uri.parse(info.checksumUrl));
      }
    }
    return;
  }
  if (picked === '查看变更') {
    await vscode.env.openExternal(vscode.Uri.parse(info.releaseUrl));
    return;
  }
  if (picked === '不再提醒') {
    await vscode.workspace
      .getConfiguration('gitea')
      .update('checkUpdates', false, vscode.ConfigurationTarget.Global);
    logInfo('已关闭自动更新检查（仍可用「Gitea: 检查更新」手动检查）');
  }
}

/**
 * 从扩展清单的 `repository` 字段解析 GitHub 仓库坐标。
 * @param context 扩展上下文
 * @returns 形如 `owner/repo` 的坐标；无法解析时返回 undefined
 */
function resolveRepoSlug(context: vscode.ExtensionContext): string | undefined {
  const pkg = context.extension.packageJSON as {
    repository?: string | { url?: string };
  };
  const raw = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  if (!raw) {
    return undefined;
  }
  // 兼容 https://github.com/o/r(.git)、git@github.com:o/r.git、带 #readme 等后缀
  const match = /github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[#?].*)?$/i.exec(raw.trim());
  return match ? `${match[1]}/${match[2]}` : undefined;
}

/**
 * 读取当前扩展版本。
 * @param context 扩展上下文
 * @returns 版本号
 */
function extensionVersion(context: vscode.ExtensionContext): string {
  return (context.extension.packageJSON as { version?: string }).version ?? '0.0.0';
}

/**
 * 请求 GitHub 的「最新 Release」接口。
 *
 * 刻意使用 `node:https` 而非全局 `fetch`：这里需要显式控制超时与错误分类，
 * 且必须保证校验证书（不受 `gitea.verifyTls` 影响）。
 * @param slug 仓库坐标
 * @param userAgent User-Agent
 * @returns Release 数据
 */
function fetchLatestRelease(slug: string, userAgent: string): Promise<GithubRelease> {
  return new Promise<GithubRelease>((resolve, reject) => {
    const request = https.request(
      {
        hostname: 'api.github.com',
        path: `/repos/${slug}/releases/latest`,
        method: 'GET',
        headers: {
          'User-Agent': userAgent,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const status = response.statusCode ?? 0;
          const text = Buffer.concat(chunks).toString('utf8');

          if (status === 404) {
            reject(new Error('未找到 Release（检查 repository 地址是否正确）'));
            return;
          }
          if (status === 403 || status === 429) {
            reject(new Error('GitHub API 访问频率受限，请稍后再试'));
            return;
          }
          if (status < 200 || status >= 300) {
            reject(new Error(`GitHub 返回 HTTP ${status}`));
            return;
          }
          try {
            resolve(JSON.parse(text) as GithubRelease);
          } catch {
            reject(new Error('GitHub 返回的不是合法 JSON'));
          }
        });
      },
    );

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error('请求 GitHub 超时'));
    });
    request.on('error', reject);
    request.end();
  });
}
