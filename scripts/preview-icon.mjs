#!/usr/bin/env node
/**
 * 生成图标预览页，便于在真实浏览器里核对 `media/gitea.svg` 的观感。
 *
 * 用法：node scripts/preview-icon.mjs [输出路径]（默认输出到系统临时目录）
 * 之后用静态服务器打开该文件即可（VS Code 活动栏对图标尺寸与描边粗细很敏感，
 * 只看代码无法判断好不好看）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svgPath = path.join(projectRoot, 'media', 'gitea.svg');
const outPath = process.argv[2] ?? path.join(os.tmpdir(), 'gitea-icon-preview.html');

const svgSource = fs.readFileSync(svgPath, 'utf8');
// 去掉固定的 width/height，交给外层容器控制尺寸
const inlineSvg = svgSource
  .replace(/<svg([^>]*?)\swidth="[^"]*"/, '<svg$1')
  .replace(/<svg([^>]*?)\sheight="[^"]*"/, '<svg$1');

/**
 * 生成一个图标格子。
 * @param {number} size 像素尺寸
 * @param {string} background 背景色
 * @param {string} color 前景色
 * @param {string} caption 说明
 * @returns {string} HTML 片段
 */
function cell(size, background, color, caption) {
  return `<figure style="background:${background};color:${color}">
  <div class="box" style="width:${Math.max(size, 40)}px;height:${Math.max(size, 40)}px">
    <div class="icon" style="width:${size}px;height:${size}px">${inlineSvg}</div>
  </div>
  <figcaption>${caption}</figcaption>
</figure>`;
}

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>Gitea 图标预览</title>
<style>
  body { margin: 0; padding: 24px; font: 13px -apple-system, "Segoe UI", sans-serif; background: #1e1e1e; color: #ccc; }
  h1 { font-size: 15px; font-weight: 600; margin: 0 0 16px; }
  h2 { font-size: 13px; font-weight: 600; margin: 28px 0 10px; color: #9d9d9d; }
  .row { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-end; }
  figure { margin: 0; padding: 12px; border-radius: 6px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .box { display: flex; align-items: center; justify-content: center; }
  .icon { display: block; }
  .icon svg { display: block; width: 100%; height: 100%; }
  figcaption { font-size: 11px; opacity: .7; }
  .zoom .icon svg { shape-rendering: geometricPrecision; }
</style>
</head>
<body>
<h1>media/gitea.svg 预览</h1>

<h2>活动栏 / 视图图标（实际尺寸）</h2>
<div class="row">
  ${cell(24, '#1e1e1e', '#cccccc', '24px · 深色主题')}
  ${cell(24, '#f3f3f3', '#3b3b3b', '24px · 浅色主题')}
  ${cell(16, '#1e1e1e', '#cccccc', '16px · 深色')}
  ${cell(16, '#f3f3f3', '#3b3b3b', '16px · 浅色')}
  ${cell(20, '#252526', '#cccccc', '20px · 侧边栏')}
  ${cell(24, '#0078d4', '#ffffff', '24px · 选中态')}
</div>

<h2>放大检查形状</h2>
<div class="row zoom">
  ${cell(48, '#1e1e1e', '#cccccc', '48px')}
  ${cell(96, '#1e1e1e', '#cccccc', '96px')}
  ${cell(96, '#f3f3f3', '#3b3b3b', '96px · 浅色')}
</div>
</body>
</html>`;

fs.writeFileSync(outPath, html, 'utf8');
console.log(`[preview-icon] 已生成 ${outPath}`);
