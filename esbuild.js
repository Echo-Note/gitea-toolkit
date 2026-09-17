// @ts-check
/**
 * 扩展打包脚本。
 *
 * 产出两个独立产物：
 *   1. dist/extension.js  —— VS Code 扩展宿主入口（CommonJS，external: vscode）
 *   2. dist/mcpServer.js  —— 内置 MCP Server（stdio 传输，由扩展或 MCP 客户端以子进程方式拉起）
 *
 * 两者共享 src/core 与 src/ai/toolCatalog，保证扩展 UI 与 AI 工具的调用语义完全一致。
 */
const esbuild = require('esbuild');
const path = require('node:path');
const fs = require('node:fs');

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production';

/** 产物目录。 */
const distDir = path.join(__dirname, 'dist');

// 生产构建前清空产物，避免上一次开发构建遗留的 sourcemap 被打进 VSIX
if (production) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

/**
 * 构造 esbuild 构建配置。
 * @param {string} entry 入口文件相对路径
 * @param {string} outfile 产物文件名
 * @param {string[]} external 外部依赖
 * @returns {import('esbuild').BuildOptions}
 */
function buildOptions(entry, outfile, external) {
  return {
    entryPoints: [path.join(__dirname, entry)],
    outfile: path.join(__dirname, 'dist', outfile),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    sourcemap: !production,
    minify: production,
    treeShaking: true,
    external,
    logLevel: 'info',
  };
}

/** 需要构建的三个目标。 */
const targets = [
  buildOptions('src/extension.ts', 'extension.js', ['vscode']),
  buildOptions('src/mcpServer/main.ts', 'mcpServer.js', []),
];

async function main() {
  if (watch) {
    const contexts = await Promise.all(targets.map((options) => esbuild.context(options)));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log('[esbuild] 已进入监听模式');
    return;
  }
  await Promise.all(targets.map((options) => esbuild.build(options)));
  console.log('[esbuild] 构建完成');
}

main().catch((error) => {
  console.error('[esbuild] 构建失败:', error);
  process.exit(1);
});
