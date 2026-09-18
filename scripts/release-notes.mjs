#!/usr/bin/env node
/**
 * 从 CHANGELOG.md 提取指定版本的条目，用作 GitHub Release 的正文。
 *
 * 为什么需要它：原来用的是 `gh release create --generate-notes`，它生成的是
 * **按 commit / PR 自动罗列**的摘要 —— 与 CHANGELOG 里那份写给人看的、有分类、
 * 有原因、有实测数据的说明完全是两回事。结果是 Release 页面看不到真正的变更说明
 * （用户报告过「Releases 缺失 changelog」）。
 *
 * 现在直接取 CHANGELOG 的对应区块，好处是**同一个来源**：
 * 扩展市场的 Changelog 标签页、`.vsix` 里的 CHANGELOG、Release 说明
 * 三者说的是同一件事，不会再出现「改了一处忘了一处」。
 *
 * 用法：
 *   node scripts/release-notes.mjs                      # 取 package.json 的 version
 *   node scripts/release-notes.mjs --version 0.8.2
 *   node scripts/release-notes.mjs --out release-notes.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 解析命令行参数。
 * @returns 解析结果
 */
function parseArgs() {
  const args = process.argv.slice(2);
  let version = null;
  let out = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--version') version = args[++i] ?? null;
    else if (args[i] === '--out') out = args[++i] ?? null;
    else {
      console.error(`[release-notes] 未知参数：${args[i]}`);
      process.exit(2);
    }
  }
  return { version, out };
}

const { version: versionArg, out } = parseArgs();

const version =
  versionArg ?? JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).version;

const changelogPath = path.join(projectRoot, 'CHANGELOG.md');
if (!fs.existsSync(changelogPath)) {
  console.error('[release-notes] 未找到 CHANGELOG.md');
  process.exit(1);
}

const lines = fs.readFileSync(changelogPath, 'utf8').split('\n');

// 找到 `## [<version>]` 标题，取到下一个 `## [` 之前。
// 注意用「标题严格等于版本号」匹配：`0.8.1` 不能匹配上 `0.8.10`，
// 也不能匹配 `## [0.8.1-rc.1]`。
const startIndex = lines.findIndex((line) => {
  const match = /^##\s+\[([^\]]+)\]/.exec(line);
  return match !== null && match[1].trim() === version;
});

if (startIndex === -1) {
  console.error(
    `[release-notes] CHANGELOG.md 里找不到版本 ${version} 的区块。` +
      '请确认版本号已递增且该区块已填写（`npm run check:changelog` 会校验这两点）。',
  );
  process.exit(1);
}

let endIndex = lines.length;
for (let i = startIndex + 1; i < lines.length; i++) {
  if (/^##\s+\[/.test(lines[i])) {
    endIndex = i;
    break;
  }
}

// 去掉标题行本身：Release 的标题已经是 `v<版本>`，正文里再写一遍「[0.8.2] - 日期」是重复的。
// 标题与正文之间的空行也一并去掉，让正文从第一个 `###` 小标题开始。
const body = lines
  .slice(startIndex + 1, endIndex)
  .join('\n')
  .replace(/^\s+/, '')
  .replace(/\s+$/, '');

if (body.length === 0) {
  console.error(`[release-notes] 版本 ${version} 的区块是空的，没有可用的说明。`);
  process.exit(1);
}

const text = `${body}\n`;

if (out) {
  fs.writeFileSync(path.resolve(projectRoot, out), text, 'utf8');
  console.log(`[release-notes] 已写入 ${out}（版本 ${version}，${body.split('\n').length} 行）`);
} else {
  process.stdout.write(text);
}
