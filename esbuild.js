// @ts-check
/**
 * 打包脚本。
 *
 * 产出：
 *   1. dist/extension.js  —— VS Code 扩展宿主入口（CommonJS，external: vscode）
 *   2. dist/mcpServer.js  —— MCP Server（stdio），供扩展以子进程方式拉起
 *   3. packages/mcp-server/dist/index.js —— 同一份 MCP Server，供独立 npm 包发布
 *
 * 三者共享 src/core 与 src/ai/tools，保证扩展 UI、AI 工具与独立 MCP 包的调用语义完全一致。
 * 第 2、3 项刻意「构建一次、复制两份」而非分别构建 —— 两条分发通道必须字节一致，
 * 分别构建会有漂移风险。
 */
const esbuild = require('esbuild');
const path = require('node:path');
const fs = require('node:fs');

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production';

/** 扩展产物目录。 */
const distDir = path.join(__dirname, 'dist');

/** 独立 MCP 包目录（见 packages/mcp-server/package.json）。 */
const mcpPackageDir = path.join(__dirname, 'packages', 'mcp-server');

/** MCP Server 的扩展内置产物路径。 */
const mcpServerOutfile = path.join(distDir, 'mcpServer.js');

// 生产构建前清空产物，避免上一次开发构建遗留的 sourcemap 被打进 VSIX
if (production) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

/**
 * 构造 esbuild 构建配置。
 * @param {string} entry 入口文件相对路径
 * @param {string} outfile 产物绝对路径
 * @param {string[]} external 外部依赖
 * @param {import('esbuild').BuildOptions} [extra] 额外配置
 * @returns {import('esbuild').BuildOptions}
 */
function buildOptions(entry, outfile, external, extra = {}) {
  return {
    entryPoints: [path.join(__dirname, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    sourcemap: !production,
    minify: production,
    treeShaking: true,
    external,
    logLevel: 'info',
    ...extra,
  };
}

const targets = [
  buildOptions('src/extension.ts', path.join(distDir, 'extension.js'), ['vscode']),
  buildOptions('src/mcpServer/main.ts', mcpServerOutfile, [], {
    // 让产物可直接执行：npm 包的 bin 在 Unix 下是符号链接，目标文件没有 shebang 就跑不起来。
    // Node 自身会忽略 shebang 行，所以扩展内置的那份带上同一行也无副作用。
    banner: { js: '#!/usr/bin/env node' },
  }),
];

/**
 * 把 MCP Server 产物投递给独立 npm 包。
 *
 * npm 包的 bin 必须可执行（chmod +x），且不能带指向不存在文件的 sourceMappingURL，
 * 否则开发构建复制过去后 sourcemap 会报错。
 */
function emitMcpPackage() {
  const targetDir = path.join(mcpPackageDir, 'dist');
  fs.mkdirSync(targetDir, { recursive: true });

  const bundled = fs
    .readFileSync(mcpServerOutfile, 'utf8')
    .replace(/\n\/\/# sourceMappingURL=.*\s*$/, '\n');

  const targetFile = path.join(targetDir, 'index.js');
  fs.writeFileSync(targetFile, bundled);
  fs.chmodSync(targetFile, 0o755);

  // 许可协议随包分发（npm 只会打包包目录内的文件）
  fs.copyFileSync(path.join(__dirname, 'LICENSE'), path.join(mcpPackageDir, 'LICENSE'));
}

async function main() {
  if (watch) {
    const contexts = await Promise.all(targets.map((options) => esbuild.context(options)));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log('[esbuild] 已进入监听模式');
    return;
  }
  await Promise.all(targets.map((options) => esbuild.build(options)));
  emitMcpPackage();
  console.log('[esbuild] 构建完成（含独立 MCP 包 packages/mcp-server）');
}

main().catch((error) => {
  console.error('[esbuild] 构建失败:', error);
  process.exit(1);
});
