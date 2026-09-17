# 变更日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本。

## [0.2.0] - 2026-09-17

### 新增

- **检查扩展自身更新**。本扩展经 GitHub Releases 分发、未发布到 Marketplace，
  编辑器**不会自动更新**，此前用户只能自己盯 Releases 页面。
  - 新命令 `Gitea: 检查更新`，手动检查并给出明确结果（含「已是最新」反馈）
  - 激活后每天自动检查一次（新配置项 `gitea.checkUpdates`，默认开启）
  - 发现新版本时可一键跳转 `.vsix` 下载或查看 Release 说明
  - 提示里附带「不再提醒」，会关闭 `gitea.checkUpdates`

  节流与容错设计：
  - 「上次检查时间」**只在请求成功后写入**，网络抖动不会让用户白等一天
  - 同一个新版本只提示一次
  - 除手动触发外，任何网络 / 解析失败都只写日志，不弹窗打扰
  - TLS 校验恒定开启，**不继承** `gitea.verifyTls`（那个开关是给内网自签名 Gitea 实例用的，
    不应影响对 github.com 的请求）
  - 使用 `node:https` 而非全局 `fetch`，以便显式控制超时并把 404 / 频率受限 / 超时区分开

### 变更

- `package.json` 补上 `repository` 字段（此前缺失，打包需加 `--allow-missing-repository`）。
  更新检查即从该字段推导 GitHub 坐标，因此也能正确处理 fork 后的仓库地址。

### 说明

- 版本比较**不复用** `core/version.ts` 里的 Gitea 版本解析：那套只看 `major.minor`、
  且忽略预发布标识，用在扩展自身上会出错（`0.1.10` 必须大于 `0.1.9`）。
  新增 `core/selfUpdate.ts` 实现完整的 semver 优先级规则，含预发布段比较
  （`0.2.0-rc.1 < 0.2.0`、`rc.2 < rc.10`、数字段优先级低于字母段）。
- 更新检查只做「提示 + 跳转下载」，**不自动下载或安装**：自动安装需依赖
  `workbench.extensions.installExtension` 这类未公开的内部命令，不适合作为默认行为。

## [0.1.5] - 2026-09-17

### 修复

- **CodeBuddy 的 MCP 面板里看不到 `Gitea Toolkit`**。原因：CodeBuddy **不消费** VS Code 的
  `contributes.mcpServerDefinitionProviders` 贡献点，它的 MCP 面板完全由用户级
  `~/.codebuddy/mcp.json` 驱动。此前只有 `mcpServerDefinitionProviders` 这条路，
  因此在 CodeBuddy 中始终无法被发现。
  - 新增命令 **`Gitea: 写入 CodeBuddy MCP 配置`**：把 `mcpServers.gitea` 合并写入用户级配置
    （优先写已存在的 `~/.codebuddy/mcp.json`，保留其它 server）
  - 激活时**自动修复过期脚本路径**：扩展安装目录名含版本号，升级后旧路径会失效
    （表现为该服务启动失败）。仅在配置文件已存在且其中确有本扩展条目时改写，不会凭空创建
  - `gitea.writeMcpConfig` 更名为「写入 MCP 配置文件（工作区）」以区分作用范围
  - 编辑器不支持 MCP Provider 时，日志改为给出可执行的指引而不是一句「不支持」

### 变更

- README 更正：删去「CodeBuddy 与 VS Code 同源内核、会自动出现」这一**错误结论**，
  改为明确的客户端接入对照表。

### 说明

- CodeBuddy 中的用户级配置需要包含访问令牌（`GITEA_TOKEN`）才能工作；
  该令牌由扩展从 `SecretStorage` 读取后写入，或沿用配置中已有的令牌。

### 工程

- 发布产物增加 `SHA256SUMS` 校验和附件；CI 在发版前会先 `sha256sum -c` 自校验一遍，
  确保附件与校验和确实对得上（v0.1.5 的 Release 已补传该附件）。
- **不额外打包 zip**：`.vsix` 本身就是 deflate 压缩的 zip 容器，套一层只会让体积变大，
  且 `code --install-extension` 不认 zip，用户还得多解压一步。
  需要源码的话，GitHub Release 页面已自动提供 `Source code (zip/tar.gz)`。
- 注意：vsix 构建**不是字节级可复现**的（zip 内含时间戳等），本地重新构建得到的 hash
  与发布件必然不同。因此 `SHA256SUMS` 只能用于核对「下载到的文件是否就是 CI 产出的那一份」，
  它和 vsix 同源生成，**不构成防篡改的信任根**。
- CI 触发条件加上 `paths-ignore`：只改 `**.md` / `LICENSE` 的提交不再触发构建与打包。
  `package.json` **刻意不忽略** —— 版本号递增正是发版的触发条件。

## [0.1.4] - 2026-09-17

### 新增

- **CI 自动化**（`.github/workflows/ci.yml`）：
  - push 到 `main` 与 PR 时执行：类型检查、ESLint、AI 工具清单与代码定义的一致性校验、
    codicon 图标名存在性校验
  - 校验通过后构建并打包 `.vsix`，作为 artifact 上传（保留 30 天）；打包失败时额外上传 `dist/` 便于排查
  - **依据打包版本自动打 tag 并发布 Release**：若 `package.json` 的版本尚无对应 tag，
    则自动创建 `v{版本}`（`--target` 精确指向本次构建的提交）并发布 Release、附上 `.vsix`；
    版本号未变更则跳过，因此日常推送不会产生 Release
  - **构建失败自动创建 Issue**：仅针对 `main`（PR 失败不建，避免刷屏），内容包含失败步骤、
    提交、运行链接与本地复现命令；同一个问题追加评论而非重复建 issue；
    按标签幂等，CI 恢复后自动关闭
  - 新增 `npm run ci` 一条命令跑完全部校验；`npm run check:workflows` 静态校验 workflow
    本身（YAML 结构、内嵌 shell 与 github-script 语法、permissions 与 API 调用的匹配）
- `scripts/check-workflows.mjs`：workflow 静态校验。GitHub Actions 的配置错误往往在推送后
  才暴露（缩进错了整个 workflow 静默不执行），该脚本在本地与 CI 提前拦住。

### 变更

- **`gitea.serverUrl` 默认值改为留空**：不再内置任何具体实例地址，首次执行
  「设置访问令牌」时会引导填写。此前内置默认值会让其他实例的用户直接连错。
- 文档、示例与预览脚本中的地址统一泛化为 `gitea.example.com`。

### 修复

- `.vscodeignore` 排除 `.github/**`，避免 workflow 文件被打进 VSIX。

## [0.1.3] - 2026-09-17

### 新增

- **树节点图标体系**（`src/vscode/views/icons.ts`）：用内置 codicon + `charts.*` 主题色区分状态，
  明暗主题自动适配，无需维护两套资源。
  - 仓库：普通 `repo` / 私有 `lock` / Fork `repo-forked` / 归档 `archive`
  - 分支：普通 `git-branch`、受保护 `lock`（警示黄）
  - Issue：进行中 `issue-opened`（绿）、已关闭 `issue-closed`（紫）
  - PR：进行中 `git-pull-request`（绿）、草稿 `git-pull-request-draft`、
    已合并 `git-merge`（紫）、已关闭未合并 `git-pull-request-closed`（红）
  - 通知：按主题类型（Issue / Pull / Commit / Repository）选图标，未读叠加信息蓝
  - 分组节点：分支 / Issue / PR / 「分配给我 / 我创建的 / 提及我的 / 待我评审」各有独立图标
    （此前所有分组统一是 `list-tree`，无法区分）
  - 空状态与错误提示统一走 `messageIcons`
- **图标离线校验与预览**：`npm run check:icons` 把用到的图标名与 `codicon.css` 的真实列表比对
  （VS Code 对拼错的图标名是**静默忽略**的，只靠 review 发现不了）；
  `npm run preview:tree` 用真实 codicon 字体渲染与运行时一致的模拟树，`npm run preview:icon`
  渲染插件图标在不同尺寸与明暗主题下的观感。

### 修复

- **重画插件图标** `media/gitea.svg`：原先是若干方块拼凑的图形。现为单色茶壶
  （Gitea = Git + Tea）——圆肩壶身 + 壶盖壶钮 + 左侧斜出壶嘴 + 右侧 C 形壶把，
  已按 16px / 20px / 24px / 48px / 96px 在明暗主题下逐档核对。

### 变更

- `icons.ts` 改为**不依赖 `vscode` 模块**，只产出 `{ id, color? }` 纯数据，
  由 `nodes.ts` 的 `toThemeIcon()` 转换（这样才可被预览脚本直接打包运行）。
- 新增节点构造器 `createBranchNode()`，把分支节点的图标与打开动作收进 `nodes.ts`。
- 移除 `GiteaNodeKind` 中从未使用的 `commit` / `file` 类型。
- 新增 devDependency `@vscode/codicons`（仅用于图标预览与校验，不进入分发包）。

## [0.1.2] - 2026-09-17

### 修复

- **点击分支提示「该条目没有可打开的网页地址」**：Gitea 的 `Branch` 结构（`GET /repos/{owner}/{repo}/branches`）
  **不含 `html_url` 字段**，节点构造时未填地址，导致「在浏览器打开」必然失败。
  新增 `src/core/urls.ts` 集中构造网页地址（分支、仓库、Issue、PR），分支地址采用
  经实例验证的 `/{owner}/{repo}/src/branch/{branch}`（旧格式 `/{owner}/{repo}/src/{branch}` 会 303 跳转）；
  分支名中的 `/` 保留、其余字符按段编码。分支节点同时补上了「点击即打开浏览器」的默认动作与含链接的 tooltip。
- **`gitea.openInBrowser` 增加兜底解析**（新增 `src/vscode/commands/nodeUrl.ts`）：节点缺少 `htmlUrl` 时
  按节点类型推导地址，避免同类问题再次出现；确实无法推导时才提示，且提示语改为指向 `gitea.serverUrl` 配置。
- **通知节点**：`subject.html_url` 为空时回退到仓库首页地址，且始终绑定打开动作（此前会静默无响应）。

### 变更

- 清理 `view/item/context` 中 `inline` 组的可见性正则，移除从未创建的 `commit` / `file` 节点类型。

## [0.1.1] - 2026-09-17

### 变更

- **`npm run package` 自动递增版本号**：新增 `scripts/bump-version.mjs`，打包前默认 patch +1，
  可用 `--part=minor|major` 或 `--set=x.y.z` 指定，并幂等地在 CHANGELOG.md 顶部插入新版本区块；
  `SKIP_VERSION_BUMP=1` 可跳过。开发构建（`npm run build` / `watch`）不递增，
  避免版本号随迭代迅速失真。
- 打包脚本不再显式调用 esbuild，改由 vsce 触发的 `vscode:prepublish` 统一负责，避免重复构建。

## [0.1.0] - 2026-09-17

### 新增

- **Gitea 版本兼容性校验**：以 1.26.4 的 OpenAPI 规范为基准，登录成功、扩展激活、
  手动触发三个时机校验服务端版本，版本不匹配（更新 / 更旧 / 低于最低支持 / 无法解析）
  时弹窗告警；同一「等级 + 版本」只提示一次，状态栏与用户信息对话框展示版本对比。
  判定逻辑集中在 `src/core/version.ts`（纯函数，`VERIFIED_GITEA_VERSION` /
  `MIN_SUPPORTED_GITEA_VERSION` 两个常量是唯一事实来源）。

- **Issue / PR 详情交互面板**（编辑器标签页 Webview）：
  - Markdown 回复框，`Ctrl/Cmd + Enter` 快速发表，草稿随面板状态持久化
  - 「评论并关闭」一键完成回复 + 关闭
  - 关闭 / 重新打开、批准 / 请求修改、按策略合并（合并前二次确认）、检出 PR 分支
  - PR 变更文件清单、评审记录、分支与增减行统计；标签 / 指派 / 里程碑 chips
  - Markdown 由 Gitea 服务端渲染（`POST /markdown`），与网页端表现一致；失败降级纯文本
  - CSP + nonce 锁定脚本来源，Webview 只上报操作意图，不接触访问令牌
- **侧边栏视图**：仓库（含分支 / 打开的 Issue / 打开的 PR 懒加载）、我的 Issue（分配给我 / 我创建的 / 提及我的）、我的 Pull Request（待我评审 / 我创建的 / 全部打开）、通知
- **24 个编辑器命令**：认证、仓库克隆与创建、分支创建、Issue 创建 / 回复 / 状态切换、PR 创建 / 打开详情 / 查看差异 / 合并 / 检出、通知已读、MCP 配置复制与写入
- **27 个 AI 工具**：覆盖仓库、文件读写与提交、CI 状态、Issue、Pull Request（含 diff、评审、合并）、组织与通知
- **CodeBuddy / AI 接入**：
  - 通过 `contributes.mcpServerDefinitionProviders` + `vscode.lm.registerMcpServerDefinitionProvider` 实现内置 MCP Server 的自动发现
  - 通过 `contributes.languageModelTools` + `vscode.lm.registerTool` 注册语言模型工具，写操作强制用户确认
  - 提供 `.codebuddy/mcp.json` / `.vscode/mcp.json` / `.mcp.json` 配置文件生成（合并语义，不覆盖既有配置）
- **核心层**：基于 `node:http(s)` 的 HTTP 客户端（支持按请求关闭 TLS 校验、超时、重定向、取消）、令牌认证、错误归一化、分页解析
- **免传仓库参数**：从工作区 git `origin` 远端自动推断 `owner` / `repo`（支持 SSH 与 HTTP(S) 形式）
- **单一事实来源的工具目录**：`npm run sync:tools` 从 zod 定义生成 `package.json` 清单，`--check` 模式供 CI 防漂移

### 变更

- **移除 `package.json` 中硬编码的 `repository` 字段**，发布信息不再绑定具体实例；
  本地打包改用 `--allow-missing-repository`
- 扩展 ID 与版本号改为从 `ExtensionContext` 读取，移除源码中硬编码的扩展标识
  （原先用硬编码 ID 拼 User-Agent，一旦更换 publisher 就会取不到版本，退化成 `0.0.0`）
- 注释、输入框占位等示例地址泛化为 `gitea.example.com`

### 说明

- 访问令牌存放于 `SecretStorage`（系统钥匙串），不写入 `settings.json`
- API 语义依据 Gitea 1.26.4 的 OpenAPI 规范逐一核对
