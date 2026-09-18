#!/usr/bin/env node
/**
 * 把 AI 工具目录同步进 package.json 的 `contributes.languageModelTools`。
 *
 * 用法：
 *   node scripts/sync-tools.mjs           写入（默认）
 *   node scripts/sync-tools.mjs --check   仅校验，若不同步则以非零码退出（供 CI 使用）
 *
 * 实现方式：用 esbuild 把 src/ai/tools/index.ts 打成临时 CJS 产物后 require，
 * 保证清单与代码来自同一份定义，杜绝人工维护导致的漂移。
 */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJsonPath = path.join(projectRoot, 'package.json');
const checkOnly = process.argv.includes('--check');

/**
 * 打包并加载一个**不依赖 vscode** 的源码模块，拿到其运行时定义。
 * @param {string} entry 相对项目根的入口路径
 * @returns {Promise<Record<string, unknown>>} 模块导出
 */
async function loadModule(entry) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitea-toolkit-sync-'));
  const outfile = path.join(tmpDir, 'mod.cjs');
  await build({
    entryPoints: [path.join(projectRoot, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    logLevel: 'warning',
  });
  const require = createRequire(import.meta.url);
  const module = require(outfile);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return module;
}

/** 校验工具定义的基本约束。 */
function validateCatalog(catalog) {
  const problems = [];
  const seen = new Set();
  for (const tool of catalog) {
    if (!/^[a-z][a-z0-9_]*$/.test(tool.name)) {
      problems.push(`工具名不符合 snake_case 规范：${tool.name}`);
    }
    if (!tool.name.startsWith('gitea_')) {
      problems.push(`工具名必须以 gitea_ 开头：${tool.name}`);
    }
    if (seen.has(tool.name)) {
      problems.push(`工具名重复：${tool.name}`);
    }
    seen.add(tool.name);
    if (!tool.description || tool.description.length < 10) {
      problems.push(`工具缺少足够的模型描述：${tool.name}`);
    }
  }
  return problems;
}

/**
 * 校验生成的 `languageModelTools` 清单。
 *
 * **为什么必须校验 `name`**：VS Code 要求工具 ID 匹配 `/^[\w-]+$/`（**不允许点号**）。
 * 一旦违规，扩展激活时 27 个工具会被逐个拒绝注册，报
 * `CANNOT register tool with invalid id`；而 package.json 里的清单本身看起来完全正常，
 * 本地类型检查与 Lint 也都发现不了 —— 2026-09-18 正是因此漏到线上。
 * @param {Array<Record<string, unknown>>} manifest 清单
 * @returns {string[]} 问题列表
 */
function validateManifest(manifest, prefix) {
  const problems = [];
  const seen = new Set();
  for (const entry of manifest) {
    const name = entry.name;
    if (typeof name !== 'string' || !/^[\w-]+$/.test(name)) {
      problems.push(`name 不符合 /^[\\w-]+$/（不能含点号等字符）：${name}`);
    } else if (!name.startsWith(prefix)) {
      problems.push(`name 未使用约定前缀「${prefix}」：${name}`);
    }
    if (seen.has(name)) {
      problems.push(`name 重复：${name}`);
    }
    seen.add(name);
  }
  return problems;
}

/**
 * 校验 package.json 里的 MCP Provider ID 与代码常量一致。
 *
 * 同样是一次「同一常量写两处」的防漂移检查：id 必须与 `registerMcpServerDefinitionProvider`
 * 传入的一致，否则提供者会静默失效（清单里声明了、但注册永远匹配不上）。
 * @param {Record<string, unknown>} pkg package.json 内容
 * @param {string} expected 代码中的期望值
 * @returns {string[]} 问题列表
 */
function validateMcpProviderId(pkg, expected) {
  const declared = pkg.contributes?.mcpServerDefinitionProviders ?? [];
  if (declared.length === 0) {
    return ['package.json 缺少 contributes.mcpServerDefinitionProviders'];
  }
  return declared
    .filter((entry) => entry.id !== expected)
    .map((entry) => `mcpServerDefinitionProviders 的 id 与代码不一致：清单「${entry.id}」/ 代码「${expected}」`);
}

/** 稳定序列化，便于比较。 */
function stableJson(value) {
  return JSON.stringify(value, null, 2);
}

async function main() {
  const tools = await loadModule('src/ai/tools/index.ts');
  const ids = await loadModule('src/ai/ids.ts');
  const catalog = tools.TOOL_CATALOG;
  const problems = validateCatalog(catalog);
  if (problems.length > 0) {
    console.error('[sync-tools] 工具定义校验失败：');
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  // 两类「清单 ↔ 代码」标识符的防漂移校验，都在此拦下
  const manifest = tools.buildLanguageModelToolManifest();
  const manifestProblems = [
    ...validateManifest(manifest, ids.LANGUAGE_MODEL_TOOL_PREFIX),
    ...validateMcpProviderId(pkg, ids.MCP_PROVIDER_ID),
  ];
  if (manifestProblems.length > 0) {
    console.error('[sync-tools] 清单校验失败：');
    for (const problem of manifestProblems) {
      console.error(`  - ${problem}`);
    }
    process.exit(1);
  }

  pkg.contributes = pkg.contributes ?? {};
  const current = pkg.contributes.languageModelTools ?? [];

  if (stableJson(current) === stableJson(manifest)) {
    console.log(`[sync-tools] 已同步，共 ${manifest.length} 个工具。`);
    return;
  }

  if (checkOnly) {
    console.error(
      `[sync-tools] package.json 的 languageModelTools 与代码定义不一致（清单 ${current.length} 条 / 代码 ${manifest.length} 条）。`,
    );
    console.error('[sync-tools] 请运行 `npm run sync:tools` 重新生成。');
    process.exit(1);
  }

  pkg.contributes.languageModelTools = manifest;
  fs.writeFileSync(packageJsonPath, `${stableJson(pkg)}\n`, 'utf8');
  console.log(`[sync-tools] 已写入 ${manifest.length} 个工具到 package.json。`);
}

main().catch((error) => {
  console.error('[sync-tools] 执行失败:', error);
  process.exit(1);
});
