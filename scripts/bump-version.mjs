#!/usr/bin/env node
/**
 * 递增扩展版本号（写入 package.json，并同步 CHANGELOG.md 的版本标题）。
 *
 * 用法：
 *   node scripts/bump-version.mjs                  # patch +1：0.1.0 → 0.1.1（默认）
 *   node scripts/bump-version.mjs --part=minor     # 0.1.0 → 0.2.0
 *   node scripts/bump-version.mjs --part=major     # 0.1.0 → 1.0.0
 *   node scripts/bump-version.mjs --set=1.2.3      # 直接指定版本
 *   node scripts/bump-version.mjs --dry-run        # 只打印结果，不落盘
 *   node scripts/bump-version.mjs --no-changelog   # 不修改 CHANGELOG.md
 *   SKIP_VERSION_BUMP=1 npm run package            # 跳过递增
 *
 * 设计说明：
 *   - 只由 `npm run package`（产出 .vsix 的构建）调用，`npm run build` / `watch` 不调用：
 *     开发迭代频繁触发构建，若每次都递增会让版本号迅速失真。
 *   - 递增后需要重新构建才谈得上"新版本"，因此调用时机在 esbuild 之前
 *     （实际上 dist 产物在运行时才读 package.json，顺序不影响正确性，但顺序更直观）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJsonPath = path.join(projectRoot, 'package.json');
const changelogPath = path.join(projectRoot, 'CHANGELOG.md');

/** 支持的递增类型。 */
const PARTS = ['major', 'minor', 'patch'];

/**
 * 解析命令行参数。
 * @returns {{ part: string, set: string | undefined, dryRun: boolean, changelog: boolean }}
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name) => {
    const hit = args.find((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
    if (!hit) {
      return undefined;
    }
    const [, value] = hit.split('=');
    return value === undefined ? true : value;
  };

  const part = get('part') ?? 'patch';
  const set = get('set');
  return {
    part: typeof part === 'string' ? part : 'patch',
    set: typeof set === 'string' ? set : undefined,
    dryRun: get('dry-run') === true || get('dry-run') === 'true',
    changelog: get('no-changelog') === undefined,
  };
}

/**
 * 校验版本字符串格式。
 * @param {string} value 版本号
 * @returns {boolean} 是否为 `x.y.z`
 */
function isValidVersion(value) {
  return /^\d+\.\d+\.\d+$/.test(value);
}

/**
 * 计算新版本号。
 * @param {string} current 当前版本号
 * @param {string} part 递增类型
 * @returns {string} 新版本号
 */
function nextVersion(current, part) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!match) {
    throw new Error(
      `package.json 中的版本号「${current}」不是 x.y.z 格式，无法自动递增。请先手动改为规范版本号，或用 --set=x.y.z 指定。`,
    );
  }
  let [major, minor, patch] = match.slice(1).map((value) => Number.parseInt(value, 10));
  if (part === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (part === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

/**
 * 生成本地日期字符串（YYYY-MM-DD）。
 * @returns {string} 日期
 */
function today() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * 在 CHANGELOG 顶部插入新版本区块（幂等：已存在该版本标题则跳过）。
 * @param {string} version 新版本号
 * @returns {boolean} 是否发生了修改
 */
function insertChangelogEntry(version) {
  if (!fs.existsSync(changelogPath)) {
    console.warn('[bump-version] 未找到 CHANGELOG.md，跳过同步');
    return false;
  }
  const content = fs.readFileSync(changelogPath, 'utf8');
  if (content.includes(`## [${version}]`)) {
    console.log(`[bump-version] CHANGELOG.md 已存在 ${version} 区块，跳过`);
    return false;
  }

  const entry = [
    `## [${version}] - ${today()}`,
    '',
    '### 变更',
    '',
    '- 待补充：请填写本次发布的主要改动，或将其归入更合适的分类（新增 / 修复 / 变更）。',
    '',
    '',
  ].join('\n');

  // 插到第一个 `## [` 版本区块之前，保持「新版本在上」的排列
  const firstEntry = content.search(/^## \[/m);
  const updated =
    firstEntry >= 0
      ? `${content.slice(0, firstEntry)}${entry}${content.slice(firstEntry)}`
      : `${content.replace(/\s*$/, '')}\n\n${entry}`;

  fs.writeFileSync(changelogPath, updated, 'utf8');
  console.log(`[bump-version] 已在 CHANGELOG.md 顶部插入 ${version} 区块（含待补充占位）`);
  return true;
}

function main() {
  if (process.env.SKIP_VERSION_BUMP === '1') {
    console.log('[bump-version] 检测到 SKIP_VERSION_BUMP=1，跳过版本递增');
    return;
  }

  const { part, set, dryRun, changelog } = parseArgs();
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const current = String(pkg.version ?? '');

  let target;
  if (set !== undefined) {
    if (!isValidVersion(set)) {
      throw new Error(`--set 的值「${set}」不是 x.y.z 格式`);
    }
    target = set;
  } else {
    if (!PARTS.includes(part)) {
      throw new Error(`--part 只支持 ${PARTS.join(' / ')}，收到「${part}」`);
    }
    target = nextVersion(current, part);
  }

  if (target === current) {
    console.log(`[bump-version] 版本未变化（${current}），跳过`);
    return;
  }

  console.log(`[bump-version] ${current} → ${target}${dryRun ? '（dry-run，不落盘）' : ''}`);
  if (dryRun) {
    return;
  }

  pkg.version = target;
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

  if (changelog) {
    insertChangelogEntry(target);
  }

  console.log('[bump-version] 完成。注意：package.json 的改动需要一并提交。');
}

try {
  main();
} catch (error) {
  console.error(`[bump-version] 执行失败：${error.message}`);
  process.exit(1);
}
