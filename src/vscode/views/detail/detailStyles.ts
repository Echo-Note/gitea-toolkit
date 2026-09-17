/**
 * 详情面板样式。全部使用 VS Code 主题变量，自动适配明暗主题与用户配色。
 */
export const DETAIL_STYLES = `
* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 0 0 140px;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  line-height: 1.6;
}

a { color: var(--vscode-textLink-foreground); text-decoration: none; }
a:hover { text-decoration: underline; }

.muted { color: var(--vscode-descriptionForeground); }
.hidden { display: none !important; }

/* ---------- 顶部头部 ---------- */
.header {
  padding: 14px 20px 12px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-sideBar-background);
  position: sticky;
  top: 0;
  z-index: 5;
}

.title-row { display: flex; align-items: flex-start; gap: 12px; }
.title { font-size: 1.25em; font-weight: 600; flex: 1; word-break: break-word; }
.title .num { color: var(--vscode-descriptionForeground); font-weight: 400; }

.header-actions { display: flex; gap: 6px; flex-shrink: 0; }

.meta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-size: 0.92em;
  color: var(--vscode-descriptionForeground);
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 0.85em;
  font-weight: 600;
  color: #fff;
  background: var(--vscode-descriptionForeground);
}
.badge.open { background: #1a7f37; }
.badge.closed { background: #cf222e; }
.badge.merged { background: #8250df; }
.badge.draft { background: #6e7781; }

.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; align-items: center; }
.chip {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 0.85em;
  font-weight: 500;
}
.chip-actor {
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
}
.branch-chip {
  font-family: var(--vscode-editor-font-family);
  background: var(--vscode-textCodeBlock-background);
  color: var(--vscode-foreground);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 0.9em;
}
.stat-add { color: #1a7f37; font-weight: 600; }
.stat-del { color: #cf222e; font-weight: 600; }

/* ---------- 正文与评论 ---------- */
.section { padding: 16px 20px; }
.section + .section { border-top: 1px solid var(--vscode-panel-border); }

.section-title {
  font-size: 0.9em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 10px;
}

.card {
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 14px;
  background: var(--vscode-editor-background);
}

.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--vscode-sideBar-background);
  border-bottom: 1px solid var(--vscode-panel-border);
  font-size: 0.92em;
}

.avatar {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  background: var(--vscode-badge-background);
}
.avatar-fallback { display: inline-block; opacity: 0.6; }

.card-body { padding: 12px; overflow-x: auto; }

.state-tag { font-weight: 600; }
.state-tag.approved { color: #1a7f37; }
.state-tag.changes { color: #cf222e; }

/* ---------- 变更文件 ---------- */
.files { width: 100%; border-collapse: collapse; font-size: 0.92em; }
.files td { padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
.files tr:last-child td { border-bottom: none; }
.files .fname { font-family: var(--vscode-editor-font-family); word-break: break-all; }
.files .fstat { text-align: right; white-space: nowrap; font-family: var(--vscode-editor-font-family); }
.files .fa { color: #1a7f37; }
.files .fd { color: #cf222e; }
.status-pill {
  font-size: 0.8em;
  padding: 0 6px;
  border-radius: 8px;
  background: var(--vscode-textCodeBlock-background);
  color: var(--vscode-descriptionForeground);
}

/* ---------- 底部回复区 ---------- */
.composer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 10px 20px 14px;
  background: var(--vscode-sideBar-background);
  border-top: 1px solid var(--vscode-panel-border);
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.12);
}

.composer textarea {
  width: 100%;
  min-height: 74px;
  max-height: 260px;
  resize: vertical;
  padding: 8px 10px;
  border-radius: 4px;
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  font-family: var(--vscode-editor-font-family);
  font-size: var(--vscode-editor-font-size, 13px);
  line-height: 1.5;
}
.composer textarea:focus { outline: 1px solid var(--vscode-focusBorder); }
.composer textarea::placeholder { color: var(--vscode-input-placeholderForeground); }

.composer-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.spacer { flex: 1; }
.hint { font-size: 0.85em; color: var(--vscode-descriptionForeground); }

button {
  padding: 4px 12px;
  border-radius: 4px;
  border: 1px solid transparent;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.95em;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}
button:hover { background: var(--vscode-button-secondaryHoverBackground); }
button:disabled { opacity: 0.5; cursor: default; }

button.primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  font-weight: 600;
}
button.primary:hover { background: var(--vscode-button-hoverBackground); }

button.danger { color: #cf222e; }
button.icon { padding: 3px 8px; }

/* ---------- Gitea 渲染出的 Markdown ---------- */
.md h1, .md h2, .md h3, .md h4 { margin: 16px 0 8px; line-height: 1.3; }
.md h1 { font-size: 1.4em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }
.md h2 { font-size: 1.2em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }
.md h3 { font-size: 1.05em; }
.md p { margin: 8px 0; }
.md ul, .md ol { margin: 8px 0; padding-left: 24px; }
.md li { margin: 2px 0; }
.md blockquote {
  margin: 8px 0;
  padding: 2px 12px;
  border-left: 3px solid var(--vscode-panel-border);
  color: var(--vscode-descriptionForeground);
}
.md code {
  font-family: var(--vscode-editor-font-family);
  font-size: 0.92em;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--vscode-textCodeBlock-background);
}
.md pre {
  padding: 10px 12px;
  border-radius: 4px;
  overflow-x: auto;
  background: var(--vscode-textCodeBlock-background);
}
.md pre code { padding: 0; background: transparent; }
.md table { border-collapse: collapse; margin: 8px 0; display: block; overflow-x: auto; }
.md th, .md td { border: 1px solid var(--vscode-panel-border); padding: 4px 10px; }
.md th { background: var(--vscode-sideBar-background); }
.md img { max-width: 100%; }
.md hr { border: none; border-top: 1px solid var(--vscode-panel-border); margin: 16px 0; }
.md input[type="checkbox"] { margin-right: 6px; }
.md .raw { white-space: pre-wrap; word-break: break-word; }
`;
