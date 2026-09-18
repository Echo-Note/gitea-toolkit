# Gitea Toolkit（VS Code 扩展）

把 Gitea 搬进编辑器，并让 AI 助手（**CodeBuddy**、Copilot、Cursor 等）直接操作 Gitea：
仓库、分支、Issue、Pull Request、通知、**工作流** 的读写全部通过同一套工具暴露给模型。

- 目标：Gitea **1.26.4**（API 依据其 OpenAPI 规范 `swagger.v1.json` 逐项核对）
- 侧边栏 4 个视图：仓库 / 我的 Issue / 我的 Pull Request / 通知
  （仓库节点下含 **工作流** 分组：工作流定义、最近运行；点作业 / 工作流都在**只读标签**里看）
- 「仓库」视图**按组织分组**、**当前工作区仓库置顶**，仓库名右侧带**铭牌**
  （语言 / 分支数 / 开放 Issue·PR / 工作流状态）
- 仓库可**按名称或 `owner/repo` 搜索**（走服务端，覆盖全部仓库而非仅已加载的）
- 列表支持**「加载更多」**，没有条数硬上限
- **Issue / PR 详情交互面板**：回复、关闭、重新打开、评审、合并、检出分支
- **工作流**（Gitea Actions）：列出工作流定义与运行记录、触发 / 重跑、在主窗口的
  **只读标签**里查看工作流定义与作业日志（可查找、可并排对比）
- 29 个编辑器命令 + **35 个 AI 工具**
- 两种 AI 接入方式：**MCP Server**（stdio）与 **语言模型工具**（`vscode.lm.registerTool`）

---

## 一、快速开始

### 安装

**推荐从扩展市场安装**，这样能自动收到更新：

| 客户端 | 装哪里 | 命令 / 页面 |
| --- | --- | --- |
| **CodeBuddy**（CN / 国际版） | **Open VSX** | `code --install-extension echo-note.gitea-toolkit` · [页面](https://open-vsx.org/extension/echo-note/gitea-toolkit) |
| **VS Code** | **VS Code Marketplace** | `code --install-extension echo-note.gitea-toolkit` · [页面](https://marketplace.visualstudio.com/items?itemName=echo-note.gitea-toolkit) |

也可以在各自客户端的扩展面板里直接搜索 **`Gitea Toolkit`**。

> CodeBuddy 的扩展源是 Open VSX，VS Code 用的是微软官方 Marketplace —— 两者是**不同的注册表**，
> 但扩展 ID 相同，所以在各自客户端里用同一条命令即可。

也可以从 [Releases](https://github.com/Echo-Note/gitea-toolkit/releases) 手动下载 `.vsix`
（离线环境、或想固定版本时）：

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

> **手动装 vsix 不会被市场自动更新**（编辑器只跟踪从市场安装的扩展）。
> 想持续拿更新请改用上面的市场安装方式。
>
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

分两种情况：

| 安装方式 | 更新方式 |
| --- | --- |
| **从扩展市场安装**（推荐） | 编辑器**自动更新**，无需任何操作 |
| **手动装 `.vsix`** | 编辑器**不跟踪**这类安装，不会自动更新 → 靠扩展内置的检查兜底 |

内置检查（主要服务第二种情况）：

- 激活后每天自动查一次 GitHub Releases（配置项 `gitea.checkUpdates`，默认开启）
- 也可随时手动执行 **`Gitea: 检查更新`**
- 发现新版本时可查看变更，或下载 `.vsix`（下载后建议按「安装」一节核对 `SHA256SUMS`）

**它靠「版本比对」而非「渠道探测」来避免打扰市场用户。** 这一点是实测结论：

VS Code **没有公开 API** 能判断扩展的安装来源；而内部的 `extensions.json` 里
`metadata.source` 实测**一律为 `gallery`** —— 两个客户端共 54 个扩展全部如此，
**包括明确用 `--install-extension <vsix>` 安装的那一个**。所以渠道不可检测。

改用版本比对达到同样效果，且不依赖任何探测：

- 市场安装的：编辑器把它更新到最新后，检查自然得出「已是最新」→ **静默**
- 手动安装的：版本一直停在旧的 → **提示**

又因为 CI 在**同一个 job** 里把同一个版本发到两个市场与 GitHub Releases，
GitHub 不会系统性领先市场，因此不存在「两条通道给出矛盾结论」的问题。

> **别混淆这两个命令**：
> `Gitea: 检查更新` 查的是**扩展自身**的版本；
> `Gitea: 检查版本兼容性` 查的是**服务端 Gitea** 的版本与本扩展已核对版本的差异。
>
> 自动检查的节流：「上次检查时间」**只在请求成功后写入**（网络抖动不会白等一天）；
> 同一个新版本只提示一次；除手动触发外，任何失败都只写日志、不打扰用户。

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
| 通用 | `Gitea: 刷新所有视图`、`Gitea: 在浏览器打开`、`Gitea: 显示日志`、`Gitea: 检查更新`、`Gitea: 搜索仓库`、`Gitea: 清除仓库搜索`、`Gitea: 加载更多` |
| 仓库 | `Gitea: 克隆仓库到工作区`、`Gitea: 新建仓库`、`Gitea: 新建分支` |
| Issue / PR | `Gitea: 新建 Issue`、`Gitea: 打开 Issue 详情面板`、`Gitea: 回复 Issue / Pull Request`、`Gitea: 在详情面板中回复`、`Gitea: 关闭 / 重新打开` |
| Pull Request | `Gitea: 新建 Pull Request`、`Gitea: 打开 Pull Request 详情面板`、`Gitea: 查看 Pull Request 差异`、`Gitea: 合并 Pull Request`、`Gitea: 检出 Pull Request 分支` |
| 工作流 | `Gitea: 查看工作流定义`、`Gitea: 查看作业日志`、`Gitea: 触发工作流`、`Gitea: 重跑工作流` |
| 通知 | `Gitea: 标记通知为已读`、`Gitea: 全部标记通知为已读` |
| AI 接入 | `Gitea: 复制 MCP 配置到剪贴板`、`Gitea: 写入 CodeBuddy MCP 配置`、`Gitea: 写入 MCP 配置文件（工作区）` |

点击 `Gitea` 状态栏条目可打开快捷菜单。

---

## 四、接入 AI 助手

扩展提供两条**互相独立**的接入路径，可同时启用：

| 路径 | 实现方式 | 适用客户端 |
| --- | --- | --- |
| **MCP Server** | 独立 stdio 子进程，暴露 35 个工具 | CodeBuddy、VS Code 及任意 MCP 客户端 |
| **语言模型工具** | `vscode.lm.registerTool`，常驻扩展宿主 | VS Code 系 |

### MCP Server：按客户端选接入方式

**前提**：先在「一、快速开始」里配好实例地址与访问令牌，否则服务能出现但调不通（会提示未设置令牌）。

| 客户端 | 怎么让它出现 |
| --- | --- |
| **CodeBuddy** | **不消费** VS Code 的 MCP 贡献点，必须落盘 → 执行 `Gitea: 写入 CodeBuddy MCP 配置` |
| **VS Code** | 支持 MCP Definition Provider → 扩展激活后自动出现在 MCP 面板，**无需落盘** |
| **其它 MCP 客户端** | **不必装扩展**：用独立包 `@echo-note/gitea-toolkit-mcp`（发布在**公共 npm**，直接 `npx`，见下） |

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
  "mcpServerDefinitionProviders": [{ "id": "giteaToolkit_mcp", "label": "Gitea Toolkit (MCP)" }]
}
```

```ts
// 运行时注册，VS Code 会自动发现并加载工具
vscode.lm.registerMcpServerDefinitionProvider('giteaToolkit_mcp', { ... });
```

访问令牌在「服务器即将启动」回调中才注入，不会长期停留在配置对象里。

#### 其它 MCP 客户端：用独立包（无需装扩展）

MCP Server 已作为**独立包** `@echo-note/gitea-toolkit-mcp` 发布，不依赖 VS Code 扩展，
任何支持 stdio 的 MCP 客户端均可接入。

**① 零配置方式（推荐）：直接用 Release 里的 tarball。**

npm/npx 支持直接执行远程 tarball，而 GitHub Release 的附件下载**是公开、免认证**的：

```bash
npx -y https://github.com/Echo-Note/gitea-toolkit/releases/latest/download/gitea-toolkit-mcp.tgz \
  --url https://gitea.example.com --token <令牌>
```

```json
{
  "mcpServers": {
    "gitea": {
      "command": "npx",
      "args": [
        "-y",
        "https://github.com/Echo-Note/gitea-toolkit/releases/latest/download/gitea-toolkit-mcp.tgz",
        "--url", "https://gitea.example.com"
      ],
      "env": { "GITEA_TOKEN": "你的令牌" }
    }
  }
}
```

想锁定版本就把 `latest` 换成具体 tag，例如 `releases/download/v0.7.0/gitea-toolkit-mcp.tgz`。

**② 直接从 npm 装（推荐，命令最短）。**

包发布在**公共 npm registry**（`@echo-note/gitea-toolkit-mcp`），**无需任何认证**：

```bash
npx -y @echo-note/gitea-toolkit-mcp --url https://gitea.example.com --token <令牌>
```

> 0.7.0–0.8.5 期间曾发在 GitHub Packages，但那个源**匿名装不了** ——
> 连公开包也要求先配 PAT 与 `~/.npmrc`；而且 `package-lock.json` 会**硬编码** registry 地址，
> 一旦提交，协作者 `npm install` 就会因为没有令牌而失败。
> **0.9.0 起改回公共 registry**，上面这一行即可。

`--help` 可查看全部参数（`--no-verify-tls`、`--timeout`、`--max-output`），命令行参数优先于环境变量。
包目录里的 README 有 Claude Desktop / Cursor 的完整示例。

> **如果连 npx 都不想用**：改用「装扩展」的方案 —— 扩展本身已经把 MCP Server 装好了，
> 配置命令是 `Gitea: 写入 CodeBuddy MCP 配置` 或 `Gitea: 复制 MCP 配置到剪贴板`。
> 独立包的价值仅在于**完全不想装 VS Code 系编辑器**的场景。

> **与扩展同源同构建**：共用 `src/core` 与工具定义；`esbuild.js` 一次构建后把**同一份产物**
> 复制给扩展与 npm 包两侧（内容字节一致，只是落点不同），因此两边行为不会漂移。
> 版本号由 `scripts/bump-version.mjs` 强制同步，CI 发布前还会校验两者一致，不一致直接失败。

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

扩展注册 **27 个语言模型工具**（`giteaToolkit_gitea_*`），
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

## 五、AI 工具清单（35 个）

未显式传 `owner` / `repo` 时，会从当前工作区的 **git origin 远端** 自动推断仓库，
所以在 Gitea 仓库里直接提问即可，不必每次重复仓库名。

| 域 | 工具 |
| --- | --- |
| 仓库（10） | `gitea_list_repos`、`gitea_get_repo`、`gitea_create_repo`、`gitea_list_branches`、`gitea_create_branch`、`gitea_list_commits`、`gitea_list_files`、`gitea_get_file`、`gitea_commit_file`、`gitea_get_commit_status` |
| Issue（6） | `gitea_list_issues`、`gitea_get_issue`、`gitea_create_issue`、`gitea_update_issue`、`gitea_comment_issue`、`gitea_list_issue_comments` |
| Pull Request（7） | `gitea_list_pulls`、`gitea_get_pull`、`gitea_get_pull_diff`、`gitea_list_pull_files`、`gitea_create_pull`、`gitea_merge_pull`、`gitea_review_pull` |
| 账号 / 通知（4） | `gitea_get_current_user`、`gitea_list_orgs`、`gitea_list_notifications`、`gitea_mark_notifications_read` |
| 工作流（8） | `gitea_list_workflows`、`gitea_list_action_runs`、`gitea_get_action_run`、`gitea_get_job_logs`、`gitea_list_artifacts`、`gitea_dispatch_workflow`、`gitea_rerun_action`、`gitea_set_workflow_enabled` |

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
| `gitea.pageSize` | `50` | 列表类视图**总共展示多少条**（1–200，超出会自动翻页补齐） |
| `gitea.enableMcpServer` | `true` | 是否启用内置 MCP Server |
| `gitea.enableLanguageModelTools` | `true` | 是否注册语言模型工具 |
| `gitea.writeCodeBuddyConfigOnActivate` | `false` | 激活时自动写入**工作区** `.codebuddy/mcp.json`（仅当文件不存在时） |
| `gitea.checkUpdates` | `true` | 每天检查一次**扩展自身**的新版本（给手动装 `.vsix` 的用户兜底，见「更新扩展」） |

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
npm run check:changelog  # CI：校验 CHANGELOG 无未填占位、版本号与 package.json 一致

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

> **关于 `repository` 字段**：0.2.0 之前 `package.json` **刻意不声明**它，理由是「避免把发布信息
> 绑定到某个私有仓库」，代价是打包必须加 `--allow-missing-repository`。
> 0.2.0 起改为**显式声明**（指向公开仓库），原因有二：更新检查需要从它推导 GitHub 坐标；
> 上架扩展市场时 `vsce` / `ovsx` 也会用它来修正 README 中的相对链接。
> 该参数已从 `npm run package` 移除。扩展 ID 与版本号仍一律从
> `ExtensionContext` 读取（`context.extension.id` / `context.extension.packageJSON`），
> 源码中不存在硬编码的扩展标识。
调试详情面板时，命令面板执行 `Developer: Open Webview Developer Tools` 可查看面板日志。

### 发布到扩展市场

**两个市场都要发**，因为它们服务完全不同的客户端：

| 市场 | 谁在用 | 发布工具 |
| --- | --- | --- |
| **Open VSX** | **CodeBuddy（CN 与国际版）**、VSCodium、Gitpod、code-server 等 | `ovsx` |
| VS Code Marketplace | 微软官方 VS Code | `vsce` |

> 实测确认：CodeBuddy 的 `product.json` 中 `extensionsGallery.serviceUrl` 指向
> `https://open-vsx.org/vscode/gallery`。**只发 MS Marketplace，CodeBuddy 用户看不到这个扩展**；
> 反过来只发 Open VSX，VS Code 用户也搜不到（VS Code 默认只查微软官方市场）。

两个市场的清单要求当前都已满足：`publisher`、`icon`（256×256 PNG，**市场禁 SVG**）、
`repository`、`license`、`README.md`、`CHANGELOG.md`，`keywords` 6 个（上限 30），
文档中无图片引用（市场要求 README / CHANGELOG 里的图片必须是 https 且非 SVG）。

#### 发到 Open VSX（CodeBuddy 用户走这条）

```bash
# 1. 注册 Eclipse 账号 https://accounts.eclipse.org/user/register
#    其中的 GitHub Username 必须与登录 open-vsx.org 用的 GitHub 账号一致
# 2. 登录 https://open-vsx.org，在 Profile 页签署 Publisher Agreement
# 3. 生成访问令牌 https://open-vsx.org/user-settings/tokens（只显示一次，注意保存）
npx ovsx create-namespace echo-note -p <TOKEN>   # 命名空间必须等于 package.json 的 publisher
npx ovsx publish gitea-toolkit-<版本>.vsix -p <TOKEN>
```

#### 发到 VS Code Marketplace

```bash
# 1. https://marketplace.visualstudio.com/manage 创建 publisher，ID 必须为 echo-note
# 2. Azure DevOps 建 PAT：Organization 选 All accessible organizations，
#    作用域 Custom defined → Marketplace → Manage
npx vsce login echo-note                                # 粘贴 PAT
npx vsce publish --packagePath gitea-toolkit-<版本>.vsix
```

#### 已接入 CI：发版时自动上架两个市场（外加独立 MCP 包）

发布由**四个 job** 完成，**无需手工执行上面的命令**：

```
resolve          解析版本号 + 判断该版本是否已发（看 Release 是否存在）
   ├─ publish-ovsx      发布到 Open VSX              ┐
   ├─ publish-vsce      发布到 VS Code Marketplace   ├ 三个并行执行
   └─ publish-npm       发布到 npm（公共 registry）   ┘
release          三个都成功后才创建 tag 与 Release
```

**为什么拆成独立 job**：放在同一个 job 里当连续三步的话，不只是串行，而且
**任一步失败会让后面的步骤被整体跳过** —— 例如 Open VSX 报错会导致 Marketplace
压根不去尝试发布。拆开后每个市场独立成败、互不牵连，也更快（三个网络请求并行）。

**启用方式**（仓库 Settings → Secrets and variables → Actions）：

| secret | 值 | 对应的目标 |
| --- | --- | --- |
| **`OVSX_PAT`** | open-vsx.org 生成的访问令牌 | Open VSX |
| **`VSCE_PAT`** | Azure DevOps PAT（Organization 须选 *All accessible organizations*，作用域须含 *Marketplace → Manage*） | VS Code Marketplace |
| **`NPM_TOKEN`** | **不推荐长期使用** —— npm 在令牌页会直接警告其安全风险（它是对的）。仅作过渡：建一个勾了「绕过 2FA」的 granular token，**只用于首次发布，成功后立即撤销**；正式做法是用下面的 OIDC 可信发布、完全不配此项 | npm（公共 registry） |

设计上的三点（三个目标一致）：

1. **未配置 secret 时静默跳过、不阻断发版**（只打一条 notice，并在运行摘要里说明）。
   所以这段逻辑可以先合入，等你拿到 token 再补 secret，**不需要再改 workflow**。
   反过来，只要 secret 存在，任何发布失败都会让那个 job 失败 —— 不会让你误以为已经上架。
2. **刻意排在「创建 Release」之前**。本流程用「`v<版本>` 的 Release 是否存在」判断该版本
   是否已发；若先建 Release 再发市场，一旦市场发布失败，重跑时该判断会变成「已发」，
   三个市场被整体跳过，这个版本就**永远上不了架**。反过来则能自愈：
   市场发成功 → 建 Release 失败 → 重跑时市场步骤幂等跳过，只补 Release。
3. **幂等**：发布前查询该版本是否已存在，已存在就跳过（失败重跑的常见场景）。
   各家的查询接口脾气不同，都不能只看发布命令的退出码：
   - Open VSX：`/api/<ns>/<name>/<版本>` 在「扩展不存在」时返回 **503 而非 404**，且偶发抖动
   - Marketplace：`extensionquery` 接口查询失败时保守放行，真正的重复由 `--skip-duplicate` 兜住

> **npm 发布也支持 OIDC 可信发布（推荐，无需长期令牌）**：在 npmjs.com 的包设置 →
> *Trusted publishing* 里添加 GitHub Actions，仓库填 `Echo-Note/gitea-toolkit`、
> 工作流文件名填 **`ci.yml`**（要与实际文件名完全一致），然后**删掉 `NPM_TOKEN` secret** 即可。
>
> 注意四点：① 可信发布要求包**已存在** —— 首次必须用令牌或本地手动发一次；
> ② 本地手动发时**必须显式带 `--otp=<6 位码>`**（实测：即便刚 `npm login` 成功、也不会自动
> 提示输 OTP，而是直接 403 —— npm 只在收到特定错误码时才交互；若账号用的是安全密钥/通行密钥、
> 拿不到 6 位码，则只能改用带「绕过 2FA」的 granular token）；
> ③ **npm 正在收紧 bypass-2FA 令牌**的自动化发布能力（目标 2027 年 1 月，届时它只能"暂存发布"
> 再由维护者 2FA 批准），所以 CI 应尽快迁到 OIDC —— 迁完就没有长期密钥，"过期"这回事也就不存在了。
> 另外它会自动生成溯源证明，此时 `repository.url` 必须与仓库地址完全匹配；
> ④ **绑定 GitHub 账号不是 2FA** —— npm 官方文档明确：GitHub 只是「账号恢复」的关联身份
> （万一丢了 2FA 设备，靠它加速找回），**发布时它不顶替验证码/TOTP**；
> 自己账号的 2FA 类型与状态可在 npmjs.com → 头像 → Account → *Two-Factor Authentication* 查看。
> 组织成员还可能被**强制**启用 2FA（自己关不掉）。
>
> ⚠️ 排查 2FA 时别用**恢复码**登录：会触发账号 **72 小时临时安全冻结**，
> 期间无法发布包、创建令牌或改账号设置。
>
> ⚠️ 若确实要建「绕过 2FA」的令牌 —— npm 会在令牌页警告它的安全风险，**那是对的**：
> 能拿到 6 位码就优先用 `--otp`，根本不用建令牌。非要建时：权限只给 `@echo-note` 的
> read + write（包尚不存在时无法选单个包，只能按 scope 授权）、有效期选最短、
> **发布成功后立刻撤销**，正式通道仍应迁到 OIDC。
>
> **凭据类错误不再阻断发版**：npm 的 401/403/2FA 类失败会降级为「提示 + 跳过」，
> 不会连累 GitHub Release（本项目踩过：市场已发布、Release 却因 npm 卡住而建不出来）。
>
> **Release 说明直接取自 CHANGELOG**（不再用 `gh release create --generate-notes` 的自动摘要）：
> 后者按 commit / PR 罗列，与 CHANGELOG 里那份有分类、有原因、有实测数据的说明完全是两回事。
> 现在「扩展市场的 Changelog 标签页」「`.vsix` 里的 CHANGELOG」「Release 说明」三者同源，
> 不会再出现改了一处忘了一处。
>
> ⚠️ **已发布的历史 Release 不会自动更新**。需要回填某个版本时：
>
> ```bash
> gh release edit v0.8.1 --notes-file <(node scripts/release-notes.mjs --version 0.8.1)
> ```

**首次上架前必须先做**（否则对应步骤会失败）：

```bash
# Open VSX：命名空间必须等于 package.json 里的 publisher，且需先签署 Publisher Agreement
npx ovsx create-namespace echo-note -p <TOKEN>

# Marketplace：在 https://marketplace.visualstudio.com/manage 创建 publisher，ID 必须为 echo-note
```

> ⚠️ **Marketplace 的认证方式有硬时限**：Azure DevOps **全局 PAT 将于 2026-12-01 完全停用**，
> 而 Marketplace 要求的正是这一类（Organization 必须选 *All accessible organizations*，
> 选单一组织会 403/401）。届时需迁移到 **Entra ID**：
> `vsce publish --azure-credential`（需 vsce ≥ 2.26.1），但需要 Azure 订阅 + 托管标识 + 服务连接，
> 是独立的一块工作。Open VSX 的令牌没有这个问题。

> 注意：**这些 job 要到下一次版本递增才会真正发布**。仅提交 workflow 改动不会触发发版
> （`resolve` 会看到 `v<当前版本>` 的 Release 已存在，各发布步骤随之跳过），
> 这是有意设计，不是故障。

#### 三个坑

1. **`publisher` 上架后不可更改**。它同时是 Marketplace 的 publisher ID 和 Open VSX 的命名空间；
   一旦改动，扩展 ID 就从 `<publisher>.gitea-toolkit` 变成了别的，**已装用户不会被自动迁移**，
   必须卸载重装。所以先确认能拿到 `echo-note` 这个 ID / 命名空间，再动手。

2. **不要在本地直接跑不带 `--packagePath` 的 `vsce publish`**。它会经由 `npm version`
   自己创建 commit 与 tag，和本项目的 CI 发版流程（`gh release create` 建 tag）打架。
   一律用 `--packagePath` 复用 CI 已构建的 vsix，做到「构建一次、多通道发布」，版本号严格一致。

3. **Marketplace 的 PAT 认证有硬时限**：Azure DevOps 全局 PAT 于 **2026-12-01 完全停用**，
   而 Marketplace 要求的就是这一类。详见上一节的警告 —— 这不是「以后有空再说」，
   到期当天 Marketplace 发布就会中断。

#### 三个通道的分工

| 通道 | 受众 | 是否自动更新 |
| --- | --- | --- |
| **Open VSX** | CodeBuddy（CN / 国际版）、VSCodium 等 | ✅ |
| **VS Code Marketplace** | 微软官方 VS Code | ✅ |
| GitHub Releases | 离线安装、固定版本 | ❌ 需手动（见「更新扩展」） |

CI 会**依次**发布到前两个市场，最后创建 GitHub Release 作为「本次发版完成」的标记。
顺序不可颠倒 —— 详见 workflow 中的注释。

> 继续发 GitHub Releases 仍有价值（离线安装、`SHA256SUMS` 校验、变更记录），
> 只要保证各通道版本号一致即可。

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
├── mcpServer/main.ts        # MCP stdio 服务进程（含命令行参数解析）
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

packages/mcp-server/         # 独立发布的 npm 包（不依赖 VS Code）
├── package.json             # 版本号由 scripts/bump-version.mjs 与扩展强制同步
├── README.md                # npm 页面正文
└── dist/index.js            # 构建产物：esbuild 用同一份 bundle 投递过来（含 shebang）
```

> `packages/mcp-server/dist/index.js` 与扩展内的 `dist/mcpServer.js` **由同一次 esbuild 构建产出**
> （构建后复制，不重复打包），保证两条分发通道的代码字节一致。

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
