#!/usr/bin/env node
/**
 * CHANGELOG 校验：未填写的占位符、版本号与 package.json 不一致。
 *
 * 为什么需要它：`scripts/bump-version.mjs` 升版本时会在 CHANGELOG 顶部插入一个
 * 「待补充」区块，而**它不会自己消失** —— 内容得有人写。可 CHANGELOG 会原样进 `.vsix`，
 * 也会显示在扩展市场的 Changelog 标签页里：0.8.1 就是这么把一个「待补充」发给了所有用户
 * （该条目已补上）。这类问题不影响功能，却直接出现在用户看得见的地方。
 *
 * 本脚本把它拦在发版之前。已接入 `npm run ci`，并且是 CI `verify` job 的一步 ——
 * 依赖链是 `release → package → verify`，所以能真正挡住发布，而不是只发个警告。
 *
 * 用法：node scripts/check-changelog.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 会被判为「还没写」的占位文本。
 *
 * 注意 `TODO` / `TBD` 这类通用词也可能出现在正常叙述里（例如「TODO 工具」），
 * 所以判定的是**整行以它开头或紧随列表符号**的形态，避免误报。
 */
const PLACEHOLDERS = ['待补充', '待填写', 'TODO：', 'TODO:', 'TBD'];

/** 收集到的问题。 */
const problems = [];

/**
 * 记录一个问题。
 * @param file 文件名
 * @param line 行号（1 起）；无行号时传 null
 * @param message 描述
 */
function report(file, line, message) {
  problems.push(line === null ? `${file}: ${message}` : `${file}:${line}: ${message}`);
}

const changelogPath = path.join(projectRoot, 'CHANGELOG.md');
if (!fs.existsSync(changelogPath)) {
  console.error('[check-changelog] 未找到 CHANGELOG.md');
  process.exit(1);
}

const lines = fs.readFileSync(changelogPath, 'utf8').split('\n');

/** 判断某行是否是「未填写」的占位行。 */
function isPlaceholderLine(line) {
  const trimmed = line.trim().replace(/^[-*]\s*/, '');
  return PLACEHOLDERS.some((word) => trimmed.startsWith(word));
}

/**
 * 找某一行往上最近的版本标题。
 * @param lineIndex 0 起的行索引
 * @returns 版本号；找不到时返回 null
 */
function versionAbove(lineIndex) {
  for (let i = lineIndex - 1; i >= 0; i--) {
    const match = /^##\s+\[([^\]]+)\]/.exec(lines[i]);
    if (match) return match[1].trim();
  }
  return null;
}

// 1. 占位符
lines.forEach((line, index) => {
  if (!isPlaceholderLine(line)) return;
  const version = versionAbove(index) ?? '(不属于任何版本区块)';
  report(
    'CHANGELOG.md',
    index + 1,
    `版本 ${version} 的条目还没写（${line.trim()}）。请补上实际改动，或删掉整个区块 —— ` +
      'CHANGELOG 会显示在扩展市场的 Changelog 标签页里，占位文本会被用户看到。',
  );
});

// 2. 最新版本标题应与 package.json 的 version 一致
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const latestHeading = lines
  .map((line, index) => {
    const match = /^##\s+\[([^\]]+)\]/.exec(line);
    return match ? { index, version: match[1].trim() } : null;
  })
  .filter((entry) => entry !== null)
  .find((entry) => /^\d/.test(entry.version));

if (!latestHeading) {
  report('CHANGELOG.md', null, '找不到任何形如 `## [x.y.z]` 的版本标题。');
} else if (latestHeading.version !== packageJson.version) {
  report(
    'CHANGELOG.md',
    latestHeading.index + 1,
    `最新版本标题是 ${latestHeading.version}，但 package.json 的 version 是 ` +
      `${packageJson.version}。两者必须一致（跑 \`npm run version:patch\` 会同时改）。`,
  );
}

if (problems.length > 0) {
  console.error(`[check-changelog] 发现 ${problems.length} 个问题：`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`[check-changelog] 校验通过（最新版本 ${latestHeading.version}，无未填占位）`);
