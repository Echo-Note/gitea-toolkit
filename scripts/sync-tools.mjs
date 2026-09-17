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

/** 打包工具目录并加载，得到运行时模块。 */
async function loadToolModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitea-toolkit-sync-'));
  const outfile = path.join(tmpDir, 'tools.cjs');
  await build({
    entryPoints: [path.join(projectRoot, 'src/ai/tools/index.ts')],
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

/** 稳定序列化，便于比较。 */
function stableJson(value) {
  return JSON.stringify(value, null, 2);
}

async function main() {
  const tools = await loadToolModule();
  const catalog = tools.TOOL_CATALOG;
  const problems = validateCatalog(catalog);
  if (problems.length > 0) {
    console.error('[sync-tools] 工具定义校验失败：');
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    process.exit(1);
  }

  const manifest = tools.buildLanguageModelToolManifest();
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
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
