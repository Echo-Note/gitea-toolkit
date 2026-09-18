#!/usr/bin/env node
/**
 * 用真实 codicon 字体把侧边栏「渲染」出来，用于核对图标与配色。
 *
 * 为什么需要它：VS Code 对拼错的图标名是**静默忽略**的（不报错、不显示），
 * 只看代码无法发现「某个节点没图标」。本脚本会：
 *   1. 从 `codicon.css` 提取全部合法图标名，校验 `src/vscode/views/icons.ts` 用到的每个 id 是否存在
 *   2. 用 `icons.ts` 里的真实映射函数生成一棵与运行时一致的模拟树，写入 HTML 供浏览器查看
 *
 * 用法：
 *   node scripts/preview-tree.mjs            生成预览页到临时目录
 *   node scripts/preview-tree.mjs <路径>     生成到指定路径
 *   node scripts/preview-tree.mjs --check    只校验图标名，不写文件（供 CI 使用）
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliArgs = process.argv.slice(2);
const checkOnly = cliArgs.includes('--check');
const outArg = cliArgs.find((arg) => !arg.startsWith('--'));
const outPath = outArg ?? path.join(os.tmpdir(), 'gitea-tree-preview.html');
const require = createRequire(import.meta.url);

/** VS Code 内置的 charts.* 主题色（深浅两套近似值，仅用于预览）。 */
const CHART_COLORS = {
  'charts.green': ['#89d185', '#388a34'],
  'charts.red': ['#f14c4c', '#d13438'],
  'charts.blue': ['#3794ff', '#007acc'],
  'charts.purple': ['#b180d7', '#68217a'],
  'charts.yellow': ['#cca700', '#bf8803'],
};

/** 需要校验的图标 id 收集器。 */
const usedIconIds = new Set();

/**
 * 把 icons.ts 打包成 CJS 后加载。
 * @returns 图标映射模块
 */
async function loadIconsModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitea-icon-preview-'));
  const outfile = path.join(tmpDir, 'icons.cjs');
  await build({
    entryPoints: [path.join(projectRoot, 'src/vscode/views/icons.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    logLevel: 'warning',
  });
  const mod = require(outfile);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return mod;
}

/**
 * 读取 codicon 字体与样式，并提取合法图标名。
 * @returns { css: string, names: Set<string> }
 */
function loadCodiconAssets() {
  const distDir = path.dirname(require.resolve('@vscode/codicons/dist/codicon.css'));
  const css = fs.readFileSync(path.join(distDir, 'codicon.css'), 'utf8');
  const fontPath = path.join(distDir, 'codicon.ttf');
  const fontBase64 = fs.readFileSync(fontPath).toString('base64');
  // 注意 codicon.css 里字体地址带缓存串（./codicon.ttf?<hash>），必须把 query 一起吃掉
  const inlined = css.replace(
    /url\(["']?\.\/codicon\.ttf[^"')]*["']?\)/g,
    `url(data:font/ttf;base64,${fontBase64})`,
  );

  const names = new Set();
  for (const match of css.matchAll(/\.codicon-([a-z0-9-]+)::?before/g)) {
    names.add(match[1]);
  }
  return { css: inlined, names };
}

/**
 * 记录并返回图标 id（用于后续校验）。
 * @param spec 图标描述
 * @returns 图标描述
 */
function track(spec) {
  usedIconIds.add(spec.id);
  return spec;
}

/**
 * 渲染一个树节点行。
 * @param {object} options 行参数
 * @returns {string} HTML
 */
function row({ label, description = '', spec, depth = 0, collapsed = false, selected = false }) {
  track(spec);
  const color = spec.color ? `style="color:var(${cssVarFor(spec.color)})"` : '';
  const twisty = collapsed ? 'codicon-chevron-right' : 'codicon-chevron-down';
  return `<div class="row${selected ? ' selected' : ''}" style="padding-left:${8 + depth * 12}px">
  <span class="codicon ${twisty} twisty"></span>
  <span class="codicon codicon-${spec.id} icon" ${color}></span>
  <span class="label">${escapeHtml(label)}</span>
  ${description ? `<span class="desc">${escapeHtml(description)}</span>` : ''}
</div>`;
}

/**
 * 主题色对应的 CSS 变量名。
 * @param name 主题色 ID
 * @returns CSS 变量名
 */
function cssVarFor(name) {
  return `--${name.replace('.', '-')}`;
}

/**
 * 转义 HTML。
 * @param text 原始文本
 * @returns 转义结果
 */
function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
}

/**
 * 生成主题相关的 CSS 变量声明。
 * @param index 0=深色 1=浅色
 * @returns CSS 声明
 */
function themeVars(index) {
  return Object.entries(CHART_COLORS)
    .map(([name, pair]) => `${cssVarFor(name)}:${pair[index]};`)
    .join('\n      ');
}

async function main() {
  const icons = await loadIconsModule();
  const { css, names } = loadCodiconAssets();

  const repo = (flags, label, desc) => ({ label, description: desc, spec: icons.repoIcon(flags) });

  const sections = [
    {
      title: '仓库',
      body: [
        row({ label: 'example-org（6）', spec: icons.groupIcons.owners(), depth: 0 }),
        row({ label: 'gitea-toolkit', description: '★ 当前 · TypeScript · 8 分支', spec: icons.repoIcon({ private: true }), depth: 1 }),
        row({ label: '分支', spec: icons.groupIcons.branches(), depth: 2 }),
        row({ label: 'main', description: 'a1b2c3d4', spec: icons.branchIcon(false), depth: 2 }),
        row({ label: 'release/1.0', description: '9f8e7d6c', spec: icons.branchIcon(true), depth: 2 }),
        row({ label: '打开的 Issue', spec: icons.groupIcons.issues(), depth: 1 }),
        row({ label: '#12 登录接口在弱网下超时', description: 'bug', spec: icons.issueIcon('open'), depth: 2 }),
        row({ label: '打开的 Pull Request', spec: icons.groupIcons.pulls(), depth: 1 }),
        row({ label: '#42 修复登录超时', description: '草稿', spec: icons.pullIcon({ state: 'open', draft: true }), depth: 2 }),
        row({ label: '#40 补充单测', description: '@lisi', spec: icons.pullIcon({ state: 'open' }), depth: 2 }),
        row({ label: 'Actions', spec: icons.actionIcons.runs(), depth: 1 }),
        row({ label: '工作流', spec: icons.actionIcons.workflows(), depth: 2 }),
        row({ label: 'CI', spec: icons.workflowIcon('active'), depth: 3 }),
        row({ label: 'Deploy', description: '已停用', spec: icons.workflowIcon('disabled_manually'), depth: 3 }),
        row({ label: '最近运行', spec: icons.actionIcons.runs(), depth: 2 }),
        row({ label: '#37 修复登录超时', spec: icons.actionStateIcon('completed', 'failure'), depth: 3 }),
        row({ label: 'build-main', spec: icons.actionStateIcon('completed', 'failure'), depth: 4 }),
        row({ label: 'deploy-main', spec: icons.actionStateIcon('completed', 'skipped'), depth: 4 }),
        row({ label: 'archived-demo', description: 'example-org', spec: icons.repoIcon({ archived: true }), depth: 0 }),
        row({ label: 'gitea-fork', description: 'example-org', spec: icons.repoIcon({ fork: true }), depth: 0 }),
        row({ label: 'public-demo', description: 'example-org', spec: icons.repoIcon({ empty: true }), depth: 0 }),
      ],
    },
    {
      title: '我的 Issue',
      body: [
        row({ label: '分配给我', spec: icons.issueGroupIcons.assigned(), depth: 0 }),
        row({ label: '#7 构建失败：npm ci 报错', description: 'team/demo', spec: icons.issueIcon('open'), depth: 1 }),
        row({ label: '#3 文档补充', description: 'team/demo', spec: icons.issueIcon('closed'), depth: 1 }),
        row({ label: '我创建的', spec: icons.issueGroupIcons.created(), depth: 0, collapsed: true }),
        row({ label: '提及我的', spec: icons.issueGroupIcons.mentioned(), depth: 0, collapsed: true }),
      ],
    },
    {
      title: '我的 Pull Request',
      body: [
        row({ label: '待我评审', spec: icons.pullGroupIcons.reviewRequested(), depth: 0 }),
        row({ label: '#42 修复登录超时', description: 'team/demo', spec: icons.pullIcon({ state: 'open' }), depth: 1 }),
        row({ label: '我创建的', spec: icons.pullGroupIcons.created(), depth: 0, collapsed: true }),
        row({ label: '全部打开', spec: icons.pullGroupIcons.all(), depth: 0, collapsed: true }),
      ],
    },
    {
      title: '通知',
      body: [
        row({ label: '登录接口超时', description: 'team/demo · 未读', spec: icons.notificationIcon('Issue', true), depth: 0 }),
        row({ label: '修复登录超时', description: 'team/demo · 未读', spec: icons.notificationIcon('Pull', true), depth: 0 }),
        row({ label: 'fix: 调整超时', description: 'team/demo', spec: icons.notificationIcon('Commit', false), depth: 0 }),
        row({ label: '仓库已迁移', description: 'team/demo', spec: icons.notificationIcon('Repository', false), depth: 0 }),
        row({ label: '未知类型通知', description: 'team/demo', spec: icons.notificationIcon('Unknown', false), depth: 0 }),
      ],
    },
    {
      title: 'PR 状态全集',
      body: [
        row({ label: '进行中', spec: icons.pullIcon({ state: 'open' }), depth: 0 }),
        row({ label: '草稿', spec: icons.pullIcon({ state: 'open', draft: true }), depth: 0 }),
        row({ label: '已合并', spec: icons.pullIcon({ state: 'closed', merged: true }), depth: 0 }),
        row({ label: '已关闭未合并', spec: icons.pullIcon({ state: 'closed' }), depth: 0 }),
        row({ label: '普通分支', spec: icons.branchIcon(false), depth: 0 }),
        row({ label: '受保护分支', spec: icons.branchIcon(true), depth: 0 }),
        row({ label: '普通仓库', spec: icons.repoIcon({}), depth: 0 }),
        row({ label: '私有仓库', spec: icons.repoIcon({ private: true }), depth: 0 }),
        row({ label: 'Fork 仓库', spec: icons.repoIcon({ fork: true }), depth: 0 }),
        row({ label: '归档仓库', spec: icons.repoIcon({ archived: true }), depth: 0 }),
      ],
    },
    {
      title: 'Actions 状态全集',
      body: [
        row({ label: '成功', spec: icons.actionStateIcon('completed', 'success'), depth: 0 }),
        row({ label: '失败', spec: icons.actionStateIcon('completed', 'failure'), depth: 0 }),
        row({ label: '超时', spec: icons.actionStateIcon('completed', 'timed_out'), depth: 0 }),
        row({ label: '已取消', spec: icons.actionStateIcon('completed', 'cancelled'), depth: 0 }),
        row({ label: '已跳过', spec: icons.actionStateIcon('completed', 'skipped'), depth: 0 }),
        row({ label: '运行中', spec: icons.actionStateIcon('in_progress', undefined), depth: 0 }),
        row({ label: '排队中', spec: icons.actionStateIcon('queued', undefined), depth: 0 }),
        row({ label: '状态未知', spec: icons.actionStateIcon(undefined, undefined), depth: 0 }),
        row({ label: '工作流启用', spec: icons.workflowIcon('active'), depth: 0 }),
        row({ label: '工作流停用', spec: icons.workflowIcon('disabled_manually'), depth: 0 }),
        row({ label: '工作流分组', spec: icons.actionIcons.workflows(), depth: 0 }),
        row({ label: '运行分组', spec: icons.actionIcons.runs(), depth: 0 }),
      ],
    },
    {
      title: '空状态 / 错误提示',
      body: [
        row({ label: '未配置访问令牌，点击设置', spec: { id: icons.messageIcons.noToken }, depth: 0 }),
        row({ label: '当前账号下没有仓库', spec: { id: icons.messageIcons.noRepo }, depth: 0 }),
        row({ label: '没有分支。', spec: { id: icons.messageIcons.noBranch }, depth: 0 }),
        row({ label: '没有打开的 Issue。', spec: { id: icons.messageIcons.noIssue }, depth: 0 }),
        row({ label: '没有打开的 Pull Request。', spec: { id: icons.messageIcons.noPull }, depth: 0 }),
        row({ label: '没有未读通知。', spec: { id: icons.messageIcons.noNotification }, depth: 0 }),
        row({ label: '没有配置 Actions 工作流。', spec: { id: icons.messageIcons.noWorkflow }, depth: 0 }),
        row({ label: '没有 Actions 运行记录。', spec: { id: icons.messageIcons.noRun }, depth: 0 }),
        row({ label: '请求失败（HTTP 401）', spec: { id: icons.messageIcons.error }, depth: 0 }),
        row({ label: '仅显示前若干条', spec: { id: icons.messageIcons.more }, depth: 0 }),
      ],
    },
  ];

  // ---------- 校验图标名 ----------
  //
  // VS Code 允许在图标 ID 后追加 `~modifier`（如 `sync~spin`）来控制动画或镜像，
  // 这些修饰符不是 codicon 名字，必须剥掉再查，否则会把合法图标误判为拼错。
  // 已支持的修饰符见 ThemeIcon 文档：spin / spin-inverse / pulse。
  const MODIFIERS = new Set(['spin', 'spin-inverse', 'pulse']);
  const baseName = (id) => {
    const index = id.indexOf('~');
    if (index < 0) {
      return id;
    }
    const modifier = id.slice(index + 1);
    if (!MODIFIERS.has(modifier)) {
      return `<非法修饰符 ${modifier}>`;
    }
    return id.slice(0, index);
  };
  const unknown = [...usedIconIds].filter((id) => !names.has(baseName(id))).sort();
  if (unknown.length > 0) {
    console.error('[preview-tree] 以下 codicon 名称不存在，运行时会被静默忽略：');
    for (const id of unknown) {
      console.error(`  - ${id}`);
    }
    process.exit(1);
  }
  console.log(`[preview-tree] 图标名校验通过（共 ${usedIconIds.size} 个）`);

  const panels = sections
    .map(
      (section) => `<section class="panel">
  <h2>${escapeHtml(section.title)}</h2>
  ${section.body.join('\n  ')}
</section>`,
    )
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>Gitea 侧边栏图标预览</title>
<style>
${css}
  body { margin: 0; padding: 20px; background: #1e1e1e; font: 13px -apple-system, "Segoe UI", sans-serif; }
  .themes { display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-start; }
  .theme { background: #252526; border: 1px solid #3c3c3c; border-radius: 6px; padding: 12px; width: 340px; }
  .theme.light { background: #f3f3f3; border-color: #d4d4d4; }
  .theme.dark { --foreground: #cccccc; --desc: #8b8b8b; --hover: #2a2d2e; ${themeVars(0)} }
  .theme.light { --foreground: #3b3b3b; --desc: #8b8b8b; --hover: #e8e8e8; ${themeVars(1)} }
  .theme { color: var(--foreground); }
  h1 { color: #ccc; font-size: 14px; font-weight: 600; margin: 0 0 14px; }
  h2 { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
       color: var(--desc); margin: 14px 0 4px; }
  .row { display: flex; align-items: center; gap: 6px; height: 22px; border-radius: 3px; }
  .row.selected { background: var(--hover); }
  .twisty { font-size: 14px; opacity: .65; width: 14px; }
  .icon { font-size: 16px; width: 16px; }
  .label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .desc { color: var(--desc); font-size: 12px; margin-left: auto; padding-left: 8px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 45%; }
</style>
</head>
<body>
<h1>Gitea 侧边栏图标预览（真实 codicon 字体）</h1>
<div class="themes">
  <div class="theme dark">${panels}</div>
  <div class="theme light">${panels}</div>
</div>
</body>
</html>`;

  if (checkOnly) {
    return;
  }
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`[preview-tree] 已生成 ${outPath}`);
}

main().catch((error) => {
  console.error('[preview-tree] 执行失败:', error);
  process.exit(1);
});
