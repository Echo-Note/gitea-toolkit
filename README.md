# Gitea Toolkit（VS Code 扩展）

把 Gitea 搬进编辑器，并让 AI 助手（**CodeBuddy**、Copilot、Cursor 等）直接操作 Gitea：
仓库、分支、Issue、Pull Request、通知的读写全部通过同一套工具暴露给模型。

- 目标：Gitea **1.26.4**（API 依据其 OpenAPI 规范 `swagger.v1.json` 逐项核对）
- 侧边栏 4 个视图：仓库 / 我的 Issue / 我的 Pull Request / 通知
- **Issue / PR 详情交互面板**：回复、关闭、重新打开、评审、合并、检出分支
- 24 个编辑器命令 + **27 个 AI 工具**
- 两种 AI 接入方式：**MCP Server**（stdio）与 **语言模型工具**（`vscode.lm.registerTool`）

---

## 一、快速开始

### 安装

从 [Releases](https://github.com/Echo-Note/gitea-toolkit/releases) 下载 `.vsix`：

```bash
# VS Code
code --install-extension gitea-toolkit-<版本>.vsix

# CodeBuddy（CN 版）
"/Applications/CodeBuddy CN.app/Contents/Resources/app/bin/code" \
  --install-extension gitea-toolkit-<版本>.vsix
```

核对下载是否与 CI 产出一致：

```bash
shasum -a 256 -c SHA256SUMS
```

> Release 只有 `.vsix` 与 `SHA256SUMS` 两个附件，**不额外提供 zip**：
> `.vsix` 本身就是 deflate 压缩的 zip，再套一层只会变大，且 `--install-extension` 不认 zip。
> 另外注意，`SHA256SUMS` 与 vsix **同源生成**，只能证明「文件与 CI 产出一致」，
> 防不了「两者被一起替换」——它不构成防篡改的信任根。

### 配置

1. 命令面板执行 **`Gitea: 设置访问令牌`**
   - 首次会要求填写实例地址（例如 `https://gitea.example.com`）
   - 令牌在 Gitea 的「设置 → 应用 → 生成令牌」中创建，需勾选 `repo`、`issue`、`notification` 权限
   - 令牌保存在系统钥匙串（`SecretStorage`），**不会写入 settings.json**
2. 左侧活动栏出现 **Gitea** 图标，展开即可浏览仓库、Issue、PR 与通知

内网自签名证书场景：把 `gitea.verifyTls` 设为 `false`。

### 更新扩展

本扩展经 GitHub Releases 分发，**未发布到 Marketplace，编辑器不会自动更新**，因此内置了更新检查：

- 激活后每天自动检查一次（`gitea.checkUpdates`，默认开启），发现新版本时提示
- 也可随时手动执行 **`Gitea: 检查更新`**
- 提示里可直接跳到 `.vsix` 下载，下载后建议按「安装」一节核对 `SHA256SUMS`

> **别混淆这两个命令**：
> `Gitea: 检查更新` 查的是**扩展自身**的版本；
> `Gitea: 检查版本兼容性` 查的是**服务端 Gitea** 的版本与本扩展已核对版本的差异。

自动检查的节流策略：每天最多请求一次 GitHub，且**只在请求成功后才记录时间**（网络抖动不会白等一天）；
同一个新版本只提示一次；任何失败都只写日志、不打扰用户。

### 版本兼容性校验

本扩展所有接口调用以 **Gitea 1.26.4** 的 OpenAPI 规范逐项核对（常量定义在
`src/core/version.ts`）。服务端版本与已核对版本不一致时会**弹窗告警**：

| 服务端版本 | 等级 | 行为 |
| --- | --- | --- |
| 主次版本与 1.26 一致（如 `1.26.4`、`1.26.10`、`v1.26.4+dev`） | `ok` | 静默通过 |
| 高于已核对版本（如 `1.27.0`、`2.0.0`） | `newer` | 弹窗提示「接口可能已变化」 |
| 低于已核对版本但 ≥ 1.21.0（LTS） | `older` | 弹窗提示「部分新接口能力可能不可用」 |
| 低于 1.21.0 | `unsupported` | 弹窗提示「版本过低，功能可能异常」，建议升级服务端 |
| 无法解析 | `unknown` | 弹窗提示「请自行确认兼容性」 |

**校验时机**：

- **登录时**（`Gitea: 设置访问令牌` 校验令牌成功后）强制重新校验，不受历史记录影响
- **扩展激活时**后台静默校验——令牌长期有效，但服务端可能被升级，此时同样需要提醒
- 手动随时可用 `Gitea: 检查版本兼容性`

**避免打扰**：同一「等级 + 版本」只提示一次（记录在 `globalState`）；
服务端升到新版本后会重新提示。状态栏 tooltip 与「显示当前登录用户」对话框都会展示
服务端版本与已核对版本，便于随时比对。

> 校验只比较主次版本：同一 `major.minor` 下的补丁差异视为兼容（Gitea 补丁版本不做破坏性变更）。

---

## 二、日常交互：怎么回复、怎么关闭

**所有写操作都在「详情面板」里完成**——侧边栏只负责定位，点开即进入一个可读可写的详情页
（编辑器标签页形式，可左右分屏对照代码）。

### 打开详情面板

| 入口 | 操作 |
| --- | --- |
| 侧边栏 | 在 `我的 Issue` / `我的 Pull Request` / 仓库下的条目上**单击**（或点悬浮的预览图标） |
| 右键菜单 | 「Gitea: 打开 Issue 详情面板」/「打开 Pull Request 详情面板」 |
| 快捷回复 | 悬浮的 💬 图标，或右键「Gitea: 在详情面板中回复」→ 直接聚焦输入框 |
| 命令面板 | `Gitea: 在详情面板中回复`（需先在树中选中节点） |

### 面板里能做什么

```
┌────────────────────────────────────────────────────────────────┐
│ #42 修复登录接口超时问题                    [刷新] [浏览器]      │
│ [进行中] @zhangsan 创建于 2 天前 · 更新于 3 小时前              │
│ fix/login-timeout → main   +120 -30  3 个文件                  │
│ [bug] [优先级/高] @lisi 里程碑: v1.2                            │
├────────────────────────────────────────────────────────────────┤
│ 正文（Gitea 服务端渲染，Markdown / 任务列表 / @提及 与网页一致） │
│ 变更文件 / 评审记录（PR）                                        │
│ 评论时间线                                                      │
├────────────────────────────────────────────────────────────────┤
│ 写下回复…（支持 Markdown，Ctrl/Cmd + Enter 快速发表）            │
│ [发表评论] [评论并关闭]              Ctrl/Cmd + Enter 快速发表   │
│ [merge ▾] [批准] [请求修改] [合并] [检出分支] [关闭]             │
└────────────────────────────────────────────────────────────────┘
```

| 我想做的事 | 怎么做 |
| --- | --- |
| **回复** | 在底部输入框写 Markdown → `Ctrl/Cmd + Enter` 或点「发表评论」 |
| **回复并顺手关闭** | 写好内容后点「评论并关闭」，一次请求完成两件事 |
| **关闭 Issue / PR** | 点「关闭」；已关闭的条目会变成「重新打开」 |
| **批准 / 请求修改** | 先在输入框写理由（请求修改必填），再点「批准」或「请求修改」 |
| **合并 PR** | 选好 `merge` / `squash` / `rebase` / `rebase-merge` → 点「合并」→ 扩展会再弹一次确认 |
| **检出 PR 分支** | 点「检出分支」，自动执行 `git fetch origin <分支>` + `git checkout <分支>` |
| **跳转到网页** | 点右上角「浏览器」，或点正文/评论里的任意链接（会在系统浏览器打开） |

**草稿不会丢**：输入内容会随面板状态持久化，切走标签页再回来仍在；面板隐藏期间关闭编辑器也不影响。

**引用代码**：需要贴大段代码或引用当前文件时，可先用编辑器的「复制」再粘贴；
Markdown 代码块、表格、任务列表都由 Gitea 服务端渲染，与网页端表现一致。

### 不需要打开面板的快捷操作

| 场景 | 入口 |
| --- | --- |
| 关闭 / 重新打开 | 树节点悬浮的 `$(issue-reopened)` 图标，或右键菜单 |
| 看 PR 代码差异 | 树节点悬浮的 `$(diff)` 图标 → 以 diff 语法高亮的编辑器标签打开 |
| 合并 PR | 树节点右键「Gitea: 合并 Pull Request」（选策略 → 确认） |
| 检出 PR 分支 | 树节点右键「Gitea: 检出 Pull Request 分支」 |
| 新建 Issue / PR / 分支 / 仓库 | 视图标题栏的 `+` 图标，或仓库节点右键菜单 |
| 全部通知标为已读 | 「通知」视图标题栏的 `$(check-all)` 图标 |

---

## 三、命令一览

| 分类 | 命令 |
| --- | --- |
| 认证 | `Gitea: 设置访问令牌`、`Gitea: 清除访问令牌`、`Gitea: 显示当前登录用户`、`Gitea: 检查版本兼容性` |
| 通用 | `Gitea: 刷新所有视图`、`Gitea: 在浏览器打开`、`Gitea: 显示日志`、`Gitea: 检查更新` |
| 仓库 | `Gitea: 克隆仓库到工作区`、`Gitea: 新建仓库`、`Gitea: 新建分支` |
| Issue / PR | `Gitea: 新建 Issue`、`Gitea: 打开 Issue 详情面板`、`Gitea: 回复 Issue / Pull Request`、`Gitea: 在详情面板中回复`、`Gitea: 关闭 / 重新打开` |
| Pull Request | `Gitea: 新建 Pull Request`、`Gitea: 打开 Pull Request 详情面板`、`Gitea: 查看 Pull Request 差异`、`Gitea: 合并 Pull Request`、`Gitea: 检出 Pull Request 分支` |
| 通知 | `Gitea: 标记通知为已读`、`Gitea: 全部标记通知为已读` |
| AI 接入 | `Gitea: 复制 MCP 配置到剪贴板`、`Gitea: 写入 CodeBuddy MCP 配置`、`Gitea: 写入 MCP 配置文件（工作区）` |

点击 `Gitea` 状态栏条目可打开快捷菜单。

---

## 四、接入 AI 助手

扩展提供两条**互相独立**的接入路径，可同时启用：

| 路径 | 实现方式 | 适用客户端 |
| --- | --- | --- |
| **MCP Server** | 独立 stdio 子进程，暴露 27 个工具 | CodeBuddy、VS Code 及任意 MCP 客户端 |
| **语言模型工具** | `vscode.lm.registerTool`，常驻扩展宿主 | VS Code 系 |

### MCP Server：按客户端选接入方式

**前提**：先在「一、快速开始」里配好实例地址与访问令牌，否则服务能出现但调不通（会提示未设置令牌）。

| 客户端 | 怎么让它出现 |
| --- | --- |
| **CodeBuddy** | **不消费** VS Code 的 MCP 贡献点，必须落盘 → 执行 `Gitea: 写入 CodeBuddy MCP 配置` |
| **VS Code** | 支持 MCP Definition Provider → 扩展激活后自动出现在 MCP 面板，**无需落盘** |
| 其它 MCP 客户端 | `Gitea: 复制 MCP 配置到剪贴板`，粘贴进客户端的 MCP 配置 |

> 这一点实测确认过：CodeBuddy 的 MCP 面板完全由 `~/.codebuddy/mcp.json` 驱动。
> 即使扩展已经在 `package.json` 声明 `contributes.mcpServerDefinitionProviders`
> 并成功调用了 `vscode.lm.registerMcpServerDefinitionProvider`，面板里**依然不会出现**该服务。

#### CodeBuddy

命令 **`Gitea: 写入 CodeBuddy MCP 配置`** 会把 `mcpServers.gitea` **合并**写入用户级配置
（优先写已存在的 `~/.codebuddy/mcp.json`，不动其它 server）。随后在 CodeBuddy 的
MCP 面板刷新（或重启编辑器），即可看到名为 `gitea` 的服务。

**升级后不用手工改路径**：扩展安装目录名含版本号，升级后旧路径会失效、表现为该服务启动失败。
扩展每次激活都会检查用户级配置里指向本扩展的脚本路径，发现过期就静默改写
（仅在该文件已存在、且其中确有本扩展的条目时才动，不会凭空创建配置）。

#### VS Code

VS Code 支持 MCP Definition Provider，扩展注册后无需落盘：

```jsonc
// package.json
"contributes": {
  "mcpServerDefinitionProviders": [{ "id": "giteaToolkit.mcp", "label": "Gitea Toolkit (MCP)" }]
}
```

```ts
// 运行时注册，VS Code 会自动发现并加载工具
vscode.lm.registerMcpServerDefinitionProvider('giteaToolkit.mcp', { ... });
```

访问令牌在「服务器即将启动」回调中才注入，不会长期停留在配置对象里。

#### 其它客户端与工作区级配置

命令 **`Gitea: 写入 MCP 配置文件（工作区）`** 会把配置写进当前工作区，可选：

- `.codebuddy/mcp.json` ← CodeBuddy 项目级配置
- `.vscode/mcp.json`
- `.mcp.json`

适合「这个仓库用这套 Gitea 配置」的场景；只想全局生效就用上面的用户级命令。

写入采用**合并**语义，只覆盖 `mcpServers.gitea`，不会破坏你已有的其他 MCP 配置。
也可以 **`Gitea: 复制 MCP 配置到剪贴板`** 后粘贴到 CodeBuddy 的「MCP → Add MCP」面板。

生成的配置形如：

```json
{
  "mcpServers": {
    "gitea": {
      "type": "stdio",
      "command": "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
      "args": ["/path/to/extension/dist/mcpServer.js"],
      "env": {
        "ELECTRON_RUN_AS_NODE": "1",
        "GITEA_SERVER_URL": "https://gitea.example.com",
        "GITEA_TOKEN": "***",
        "GITEA_VERIFY_TLS": "true"
      }
    }
  }
}
```

### 语言模型工具

扩展注册 **27 个语言模型工具**（`giteaToolkit.gitea_*`），
在 Craft / Agent 模式下输入任务即可被自动调用，例如：

> 帮我在 team/demo 建一个 Issue：登录接口在弱网下超时，标签 bug，指派给 lisi

> 看一下 #42 这个 PR 的 diff，如果有问题就发一条 review 请求修改，否则批准

> 帮我基于 main 建一个 `feature/login-timeout` 分支，提交 README 变更，然后开一个 PR 指派 lisi 评审

> 关闭 #7，并在下面回一条「已在新版本修复」

**写操作会强制确认**：`gitea_create_*`、`gitea_update_issue`、`gitea_merge_pull`、
`gitea_review_pull`、`gitea_commit_file` 等在 VS Code 语言模型工具路径下会先弹出确认卡片，
展示完整入参，避免 AI 误改线上数据。

### 校验连通性

`Gitea: 显示当前登录用户` 可用于校验令牌与实例连通性（也会写入日志）。

---

## 五、AI 工具清单（27 个）

未显式传 `owner` / `repo` 时，会从当前工作区的 **git origin 远端** 自动推断仓库，
所以在 Gitea 仓库里直接提问即可，不必每次重复仓库名。

| 域 | 工具 |
| --- | --- |
| 仓库（10） | `gitea_list_repos`、`gitea_get_repo`、`gitea_create_repo`、`gitea_list_branches`、`gitea_create_branch`、`gitea_list_commits`、`gitea_list_files`、`gitea_get_file`、`gitea_commit_file`、`gitea_get_commit_status` |
| Issue（6） | `gitea_list_issues`、`gitea_get_issue`、`gitea_create_issue`、`gitea_update_issue`、`gitea_comment_issue`、`gitea_list_issue_comments` |
| Pull Request（7） | `gitea_list_pulls`、`gitea_get_pull`、`gitea_get_pull_diff`、`gitea_list_pull_files`、`gitea_create_pull`、`gitea_merge_pull`、`gitea_review_pull` |
| 账号 / 通知（4） | `gitea_get_current_user`、`gitea_list_orgs`、`gitea_list_notifications`、`gitea_mark_notifications_read` |

`gitea_create_issue` / `gitea_update_issue` 的 `labels` 接受**标签名称**（大小写不敏感），
扩展会自动解析为 Gitea 需要的标签 ID，无法识别的标签会被忽略并在结果中说明。

---

## 六、配置项

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `gitea.serverUrl` | 空 | 实例地址。刻意留空，首次执行「设置访问令牌」时会引导填写 |
| `gitea.defaultOwner` | 空 | 新建仓库时的默认组织 |
| `gitea.verifyTls` | `true` | 是否校验 HTTPS 证书 |
| `gitea.requestTimeoutMs` | `20000` | 请求超时 |
| `gitea.pageSize` | `50` | 列表分页大小 |
| `gitea.enableMcpServer` | `true` | 是否启用内置 MCP Server |
| `gitea.enableLanguageModelTools` | `true` | 是否注册语言模型工具 |
| `gitea.writeCodeBuddyConfigOnActivate` | `false` | 激活时自动写入**工作区** `.codebuddy/mcp.json`（仅当文件不存在时） |
| `gitea.checkUpdates` | `true` | 每天检查一次**扩展自身**的新版本 |

> 另有 `gitea.ignoreCertificates`，是 `gitea.verifyTls` 的反向兼容别名（已标记废弃），
> 仅为兼容旧配置保留，新配置请一律使用 `gitea.verifyTls`。

---

## 七、开发

```bash
npm install
npm run build         # 构建 dist/extension.js 与 dist/mcpServer.js（不递增版本号）
npm run watch         # 监听模式
npm run compile       # tsc --noEmit 类型检查
npm run lint          # ESLint
npm run check:tools   # CI：校验 package.json 工具清单与代码定义是否一致
npm run check:icons   # CI：校验所有 codicon 图标名真实存在

# 图标（VS Code 对拼错的图标名是静默忽略的，必须能离线核对，见下文「图标」一节）
npm run preview:icon  # 生成插件图标预览页（不同尺寸 / 明暗主题）
npm run preview:tree  # 生成侧边栏图标预览页（真实 codicon 字体）

# 打包（会先把版本号 +1，再产出 .vsix）
npm run package       # patch +1：0.1.2 → 0.1.3
npm run version:minor # 手动递增：minor +1
npm run version:major # 手动递增：major +1
npm run version:bump -- --set=0.2.0 --dry-run   # 指定版本 / 预演
SKIP_VERSION_BUMP=1 npm run package             # 本次打包不递增
```

**为什么只有 `package` 递增版本号**：反复用同一个版本号打包，本地安装时 VS Code 会认为
版本未变而不更新；但开发构建（`build` / `watch`）触发频繁，若每次都递增会让版本号迅速失真。
`package` 除递增 `package.json` 外，还会在 `CHANGELOG.md` 顶部**幂等地**插入新版本区块
（已存在该版本标题则跳过），避免漏记版本。递增后的 `package.json` 与 `CHANGELOG.md`
属于源码改动，需要一并提交。

打包脚本本身不调用 esbuild —— 由 vsce 触发的 `vscode:prepublish` 统一负责，避免重复构建。

### CI 与发版流程

`.github/workflows/ci.yml` 是唯一的流水线（分为 verify / package / release / 失败处理四组 job）：

| 时机 | 行为 |
| --- | --- |
| push 到 `main`、面向 `main` 的 PR | 校验（`tsc` / ESLint / 工具清单 / 图标名）→ 构建打包 → 上传 `.vsix` artifact |
| `package.json` 的版本还没有对应 tag | 自动创建 `v{版本}`（指向本次构建的提交）并发布 Release，附件为 `.vsix` |
| 版本号未变更 | 只产出 artifact，**不发布** |
| `main` 上任何 job 失败 | 自动创建 issue（含失败步骤、提交、运行链接、本地复现命令）；同一问题追加评论而非重复建 |
| `main` 恢复通过 | 自动关闭遗留的失败 issue |

**所以「发版」就等于「升级版本号并推送」**，tag 与 Release 都由流水线依据 `package.json`
的版本创建，不需要手工 `git tag`：

```bash
npm run version:patch          # 0.1.4 → 0.1.5，并在 CHANGELOG 顶部插入新区块
# 填写 CHANGELOG 后：
git add -A && git commit -m "chore: 发布 v0.1.5" && git push
```

> 未采用「每次 push 都自动发版」是有意的：那会让版本号随每次提交增长，Release 也变成噪音。
> 若确实需要，去掉 `release` job 的 `if` 条件并补一步 `npm run version:patch` + 提交即可，
> 提交信息需带 `[skip ci]` 以免流水线自我触发。

workflow 本身也有校验：`npm run check:workflows` 会检查 YAML 结构、内嵌 shell 与
github-script 的语法，以及 `permissions` 是否覆盖了代码里调用的 REST API
（显式声明 `permissions` 后，未列出的 scope 会被置为 `none`，漏掉就是 403）。

按 `F5` 启动「运行扩展」调试配置即可加载扩展。

> **关于 `repository` 字段**：`package.json` **刻意不声明** `repository`，避免把发布信息
> 绑定到某个具体实例或私有仓库。发布到 Marketplace 时由 CI 注入，本地打包用
> `--allow-missing-repository`（已写进 `npm run package`）。扩展 ID 与版本号一律从
> `ExtensionContext` 读取（`context.extension.id` / `context.extension.packageJSON`），
> 源码中不存在硬编码的扩展标识。
调试详情面板时，命令面板执行 `Developer: Open Webview Developer Tools` 可查看面板日志。

### 目录结构

```
src/
├── core/                    # 与 VS Code 完全解耦，扩展与 MCP Server 共用
│   ├── http.ts              # 基于 node:http(s) 的 HTTP 客户端（支持关闭 TLS 校验）
│   ├── giteaClient.ts       # 认证、URL 拼装、错误归一化、分页解析
│   ├── repoRef.ts           # git 远端 ↔ Gitea 仓库坐标解析
│   ├── format.ts            # 时间 / 截断 / HTML 转义与 URL 补全
│   ├── urls.ts              # 网页地址构造（分支等实体 API 不返回 html_url）
│   ├── version.ts           # Gitea 版本解析与兼容性判定（唯一基准常量）
│   ├── types.ts             # Gitea 1.26.x 实体类型
│   └── operations/          # 按域拆分的业务操作（repos / issues / pulls / misc）
├── ai/
│   ├── tools/               # ★ AI 工具目录（单一事实来源）
│   ├── mcpProvider.ts       # 动态注册 MCP Server
│   ├── mcpConfig.ts         # MCP 启动参数与配置文件生成
│   └── lmTools.ts           # vscode.lm.registerTool 适配
├── mcpServer/main.ts        # 独立 MCP stdio 服务进程
└── vscode/
    ├── config.ts            # 配置 + SecretStorage 令牌
    ├── service.ts           # 客户端缓存、当前用户、默认仓库推断
    ├── mcpConfigWriter.ts   # MCP 配置文件读写（合并语义）
    ├── git.ts               # git 命令封装
    ├── statusBar.ts         # 状态栏
    ├── commands/            # 命令处理器（按域拆分）
    └── views/
        ├── detail/          # ★ 详情交互面板（Webview）
        ├── icons.ts         # 节点图标与配色（纯数据，可离线预览 / 校验）
        ├── nodes.ts         # 树节点结构与交互绑定
        └── *Provider.ts     # 4 个树视图
```

### 设计要点

**1. 详情面板只上报意图，不接触令牌**
Webview 通过 `postMessage` 上报 `reply` / `setState` / `review` / `merge` / `checkout` 等意图，
真正的 Gitea API 调用、确认弹窗、错误处理全部在扩展宿主完成。
Webview 通过 `Content-Security-Policy` + nonce 锁定脚本来源，图片只允许扩展资源与目标实例。

**2. Markdown 交给 Gitea 服务端渲染**
调用 `POST /markdown` 而非本地渲染库，保证任务列表、`@`提及、Issue 引用、代码高亮
与网页端完全一致；接口不可用时降级为纯文本 `<pre>`。

**3. 单一事实来源的 AI 工具目录**
`src/ai/tools/` 下每个工具只用 zod 定义**一份**入参形状与处理器，随后自动派生出三处产物：

1. `contributes.languageModelTools` 的 JSON Schema（`npm run sync:tools` 生成，CI 用 `--check` 防漂移）
2. `vscode.lm.registerTool` 的运行时处理器
3. MCP Server 的工具列表

新增一个能力只需在对应域文件中追加一条 `defineTool({...})`，无需三处同步。

### 图标体系

**插件图标**（`media/gitea.svg`）：单色 `currentColor` 茶壶（Gitea = Git + Tea），
在活动栏 / 视图标题中以 24px 与 16px 两档显示，跟随主题前景色自动着色。

**树节点图标**：集中在 `src/vscode/views/icons.ts`，用内置 codicon + `charts.*` 主题色表达状态：

| 节点 | 图标 | 配色 |
| --- | --- | --- |
| 仓库（普通 / 私有 / Fork / 归档） | `repo` / `lock` / `repo-forked` / `archive` | 归档用警示黄 |
| 分支（普通 / 受保护） | `git-branch` / `lock` | 受保护用警示黄 |
| Issue（进行中 / 已关闭） | `issue-opened` / `issue-closed` | 绿 / 紫 |
| PR（进行中 / 草稿 / 已合并 / 已关闭） | `git-pull-request` / `-draft` / `git-merge` / `-closed` | 绿 / 灰 / 紫 / 红 |
| 通知（按类型，未读加色） | `issue-opened` `git-pull-request` `git-commit` `repo` | 未读用信息蓝 |
| 分组（分支 / Issue / PR / 分配给我 …） | 各自的 `git-branch` `issue-opened` `git-pull-request` `account` … | 同语义色 |

`icons.ts` **不依赖 `vscode` 模块**，只产出 `{ id, color? }` 纯数据，由 `nodes.ts` 的
`toThemeIcon()` 转换为 `vscode.ThemeIcon`。这样做是为了能离线验证：

- VS Code 对**拼错的图标名是静默忽略**的（不报错、不显示），只看代码发现不了
- `npm run check:icons` 会把 `icons.ts` 用到的每个名字与 `codicon.css` 里的真实列表比对，不存在则退出码非 0
- `npm run preview:tree` 用**真实 codicon 字体**渲染一棵与运行时一致的模拟树（明暗主题各一份），
  可直观核对图标语义与配色

新增节点类型或调整图标时，改 `icons.ts` 后跑这两个命令即可，无需启动 VS Code。

---

## 八、已知限制

- 私有仓库的**附件图片**（`/attachments/...`）在 Webview 中可能无法加载：
  Webview 请求不携带访问令牌。头像与公开资源正常。
- 详情面板**不支持行级代码评论**（Gitea 的 `pulls/{index}/reviews` 行内评论接口需指定
  diff 位置），目前只支持整体评审与对话评论。
- 「检出 PR 分支」不支持来自 fork 的 PR，需先手工添加对应远端。
- 合并策略仅支持 `merge` / `squash` / `rebase` / `rebase-merge`；强制合并与
  「检查通过后自动合并」需在 Gitea 网页端操作。
- MCP Server 以子进程运行，无法直接打开系统浏览器（相关工具只返回链接）。
- AI 工具没出现在对话里时，对照「四、接入 AI 助手」先确认你的客户端走哪条路：
  CodeBuddy 必须先用 `Gitea: 写入 CodeBuddy MCP 配置` 落盘，VS Code 则开箱即用。
  也别漏了前提——未设置访问令牌时服务能出现，但调用会失败。

## 九、许可证

MIT
