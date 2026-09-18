# 变更日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本。

## [0.9.0] - 2026-09-18

### 变更

- **独立 MCP 包改发布到公共 npm registry**（`registry.npmjs.org`，此前是 GitHub Packages）。

  0.7.0 时为了让发布流程「不需要额外 secret」，把 `@echo-note/gitea-toolkit-mcp` 发到了
  GitHub Packages。但那个源有个硬伤：**匿名装不了** —— 连公开包也要求先配 PAT 与
  `~/.npmrc`；而且 `package-lock.json` 会硬编码 registry 地址，一旦提交，协作者
  `npm install` 就会因为没有令牌而失败。用户实际只能去 Releases 下 tarball，体验很差。

  而 ModelScope MCP 广场对「可托管部署」的 STDIO 型服务**明确要求包在 npmjs.org / PyPI 上**。
  因此改回公共 registry，现在一行即可用：

  ```bash
  npx -y @echo-note/gitea-toolkit-mcp --url https://gitea.example.com --token <令牌>
  ```

  顺带：
  - 加上 `npm publish --provenance`（来源证明，把「这个包确实由本仓库的这次构建产出」
    写进 npm 的签名记录）
  - 移除为 GitHub Packages 写的包级 `.npmrc`（作用域映射不再需要）
  - Releases 里的 `.tgz` 附件**保留**，作为离线 / 固定版本场景的备用通路

  启用方式：仓库 secret **`NPM_TOKEN`**（未配置时静默跳过，不阻断发版）。
  唯一前置条件：`@echo-note` 这个 scope 需已在 npmjs.org 注册。

### 工程

- **npm 发布支持两种认证，且凭据类失败不再阻断发版。**

  首次真实发布时踩到 **403**。原因不是权限范围（令牌对 `echo-note` 组织有读写权），
  而是账号开启 2FA 后 **granular token 必须显式启用「绕过 2FA」**，否则 npm 拒绝发布：

  > Two-factor authentication or granular access token with bypass 2fa enabled
  > is required to publish packages.

  更麻烦的是它把整条流水线卡住了 —— **两个扩展市场其实已经发布成功**，
  却因为 `release` job 需要 `publish-npm` 成功而一直建不出 GitHub Release。

  现在两处改进：

  - 认证支持「`NPM_TOKEN`」与「**OIDC 可信发布**（无需任何令牌）」二选一。
    后者需在 npm 包设置里配置 Trusted Publisher 指向本仓库的 `ci.yml`；
    本 job 已声明 `id-token: write`，满足其要求。注意它要求包**已存在**，
    所以首次发布只能用令牌或本地手动发一次。
  - **凭据类错误（401/403/ENEEDAUTH/EOTP/2FA）降级为「醒目提示 + 跳过」**，
    不再阻断 Release —— 凭据是配置问题，不该让已经发出去的市场版本连 Release 都建不出来。
    配置好后重跑即可补齐，发布步骤本身是幂等的。

- CI 的发布 job 由 `publish-ghpkg` 更名为 `publish-npm`，权限从 `packages: write`
  改为 `id-token: write`（`--provenance` 与 OIDC 都需要）。
- README 的「接入 AI 助手」一节按公共 registry 重写（原先那段 GitHub Packages 的
  一次性认证说明已不再需要）。


## [0.8.5] - 2026-09-18

### 变更

- **作业日志与工作流定义改在「主窗口的只读标签」里打开**（此前是输出面板）。

  这个位置换了三次，把结论记在这里。三种做法对比：

  | 做法 | 只读 | 主窗口 | 查找 / 并排对比 | 问题 |
  | --- | --- | --- | --- | --- |
  | `openTextDocument({content})` | ✗ 未保存文档 | ✓ | ✓ | 标题是 `Untitled-1`，关闭时问「是否保存」 |
  | 输出面板 | ✓ | ✗ | ✗ | 不占标签，但检索能力弱、同一时刻只能看一份 |
  | **只读虚拟文档**（现在） | ✓ | ✓ | ✓ | 标题即文件名，`.yml` 自动按 YAML 高亮 |

  实现上**完全使用平台能力，没有自造查看器**：

  - `workspace.registerTextDocumentContentProvider()` —— 官方类型定义原文就是
    *add **readonly documents** to the editor*，只读由 VS Code 保证，扩展不需要自己控制；
    关闭时不会问是否保存，也不会出现「未保存」状态
  - **标签标题与语言由平台从 URI 路径推导**：最后一段写什么文件名，标签就显示什么
  - `languages.setTextDocumentLanguage()` 在需要时明确指定 `.yml` 按 YAML 高亮
  - `onDidChange` + `EventEmitter<Uri>`：重新生成同一份文档时刷新已打开的编辑器

  > 作业名里不适合当文件名的字符（`/`、`:`、`*`、`?` 等）会替换成空格并限长 60 字符 ——
  > 既让标签可读，也避免 `/` 把 URI 路径「撑开」到别的位置。

- **点击「工作流定义」里的条目改为查看其内容**（YAML 原文），不再直接跳浏览器。

  原先左键打开浏览器，而且**回落出来的条目全都指向同一个仓库 Actions 页**
  （`htmlUrl` 写死了通用地址）—— 点哪条都一样，等于没有这个功能。
  这是 0.8.4 引入的问题。

  现在左键在主窗口查看工作流定义，「在浏览器打开」保留在右键菜单里，
  与「触发」「启用 / 停用」并列。

- 工作流条目的浏览器地址改用 **contents 接口自带的 `html_url`**（精确指向该文件），
  省掉「为了拼网页地址还要再查一次默认分支」的请求。

### 新增

- 命令 `Gitea: 查看工作流定义`（`gitea.showWorkflow`）。
- README 的命令一览补上「工作流」一类（此前漏列了这几个命令）。

### 工程

- 作业日志不再写入输出面板，原先的 `Gitea 工作流日志` 输出通道已移除。


## [0.8.4] - 2026-09-18

### 修复

- **「工作流定义」一栏永远是空的，而「最近运行」里明明有记录。**

  根因在 Gitea 的接口本身：`GET /actions/workflows` **只枚举 `.gitea/workflows`，
  完全忽略 `.github/workflows`**。用你实例上的真实数据对照（表格是最直接的证据）：

  | 仓库 | `.gitea/workflows` | `.github/workflows` | 接口返回 |
  | --- | --- | --- | --- |
  | `actions/build-push-action`（169 条运行记录） | 不存在 | 10 个 YAML | **0 条** |
  | `actions/black`（有运行记录） | 不存在 | 13 个 YAML | **0 条** |
  | `GaoXiaogang/cdt_data_assets` | 不存在 | 不存在 | 0 条（正常） |

  也就是说，工作流写在 `.github/workflows` 时（镜像 GitHub Actions 的仓库全是这样），
  这一栏必然是空的 —— 不是扩展的问题，但用户看不到东西。

  现在改成**以文件列表为准，接口只用来补「启用状态」**：两个目录都列，按文件名与
  接口条目合并。实测同两个仓库能列出 **10 / 13 个**。

  一开始写的是「接口为空才回落到文件列表」，但那样会**漏掉一个仓库同时使用两个目录**
  的情况 —— 接口有返回就直接 return 了，`.github/workflows` 下的看不见。
  这是复查时发现的，已改成两者都取再合并。

  拿不到状态的条目渲染为**状态未知**：右侧标出所在目录（如 `.github/workflows`），
  图标不再用「禁止符」—— 不能凭空断言它被停用了。
  另外接口本身失败时也不再让整个分组打不开，降级为「没有状态信息」。

  > 为什么不干脆用运行记录反推工作流：那样只能看到「跑过的」，
  > 新加还没跑过的会缺席。列目录才是「定义」的完整来源。

- **点作业只看到「正在获取…」，没有日志内容。**

  这一条查下来**并不是"面板没打开"**，而是服务端确实没有日志可给。接口返回：

  ```json
  {"message":"not found","errors":["logs have been cleaned up"]}
  ```

  Gitea 会对作业日志做**保留期清理**，旧运行的日志已经不存在了。
  此前这种情况会弹一句指向「令牌」的通用报错（0.8.3 已改为按「没有日志」处理）。

  本次让它**明确可辨**：

  - 输出面板改用 `show()` 而不是 `show(true)` —— 必须确保面板真的被打开并切到该通道，
    让出焦点是次要的
  - 日志为空时**额外给一条通知说明原因**（运行已取消 / 服务端已清理）

  > 否则面板里只有一行标题，看起来像「什么都没发生」。实测你实例上那些镜像仓库的旧运行
  > 基本都属于「日志已被清理」这一类。


## [0.8.3] - 2026-09-18

### 修复

- **已取消的作业点开就报「资源不存在，或当前令牌无权访问」**。

  作业被取消、或还没开始执行时，服务端根本不存在日志文件，
  `GET /actions/jobs/{job_id}/logs` 会返回 **404** —— 该接口在 Gitea 的 OpenAPI 规范里
  本来就同时声明了 400 与 404。这不是异常，也不是权限问题，但用户看到的是一句
  通用的、指向「令牌」的错误，很容易被误导去查配置。

  现在 404 按「**该作业没有日志**」处理，并在输出面板里给出真正的原因
  （常见原因：运行被取消、作业尚未开始执行，或日志已被清理）。

  顺带加固了展开「最近运行」时的同类问题：若那条运行记录已被清理，不再抛
  「Gitea 命令失败」的通用弹窗，而是降级成一条说明节点，详细原因写进
  「Gitea: 显示日志」。

### 变更（界面文案与呈现）

- **作业日志改在输出面板显示，不再弹出未保存的编辑器文档**。

  原先用 `openTextDocument({ content })` 打开日志，会生成一个**未保存的临时文档**：
  标题是 `Untitled-1`、占一个编辑器标签、关闭时还要问「是否保存」，
  而且与「Issue / PR 走详情面板」的体验不一致。

  日志本来就是「输出」类内容，现在统一进 **「Gitea 工作流日志」输出面板**：
  不占编辑器、不会被误改、随时可用同一条命令切回来；面板顶部写清是哪个仓库的哪个作业。

  > 每次查看会先清空面板：既避免长时间使用后无限增长，也保证重复点击同一个作业时
  > 看到的就是它自己的日志。

- **界面里把「Actions」改称「工作流」**：仓库节点下的分组、「重跑工作流」命令、
  8 个工作流 AI 工具的显示名与说明、仓库铭牌（`Actions 关闭` → `工作流未启用`）、
  MCP Server 的自身描述，全部统一。

  > 内层那个列出 YAML 的分组相应改叫「**工作流定义**」—— 外层已经叫「工作流」了，
  > 同名会让树里出现两级一模一样的标签。
  > Gitea 自身的功能名（`has_actions` 字段、`gitea_*` 工具 ID）保持不变，
  > 只是面向用户的措辞统一，因此不影响已有配置与集成。


## [0.8.2] - 2026-09-18

### 修复

- **`gitea.pageSize` 设成 100 / 500 完全没效果**。用户报告「输入 500 或者 100 都无效」。

  根因有两层，缺一不可：

  1. **Gitea 服务端对单次请求的条数有硬上限**。该值由服务端配置决定，并可通过
     `GET /api/v1/settings/api` 读到：本实例返回 `max_response_items: 50`。
     **超出部分被静默丢弃、不报错** —— 实测 `limit=51/100/200/500` 一律只回 50 条。
  2. **本扩展只请求了一页**。因此 `pageSize` 实际语义是「每页条数」而非「展示条数」，
     超过 50 的部分永远拿不到。而默认值恰好是 50，所以改成 100 或 500 后**结果完全一样**，
     表现为「怎么改都没反应」。

  修复：新增 `GiteaClient.requestPaged()`，按页收集直到凑够目标条数或没有下一页。
  所有接受 `page` / `limit` 的列表操作改走它（仓库 / Issue / PR / 通知 / 提交 / 分支 / Actions），
  因此**视图与 AI 工具同时受益** —— 此前 AI 工具声明 `limit` 上限 100~200，
  实际同样被截断到 50。

  实测（同一实例）：`limit` 10→10、50→50、**51→51**、**100→100**（修复前均为 50）；
  请求 200 时因数据总量只有 105 条而返回 105 条，符合预期；小值（5）行为不变、不会多发请求。

### 新增

- **列表底部新增「加载更多」**，彻底移除条数硬上限。

  上一条修好了「100 拿得到」，但**只要还有上限，就会有下一个上限** —— 设 200 之后想要 500 呢？
  所以不该靠不断调大数字，而是改成增量加载：

  - 列表底部若还有更多，出现一个「已显示 N 条，点击加载更多…」的条目
  - 点击后按 `gitea.pageSize` 追加下一批，**没有上限**
  - 首次展示的条数仍由 `gitea.pageSize` 决定（即它的语义是「初始条数」）

  已接入全部列表：仓库、分支、打开的 Issue / PR、Actions 运行记录，
  以及「我的 Issue / 我的 Pull Request / 通知」三个视图的各分组。

  实现上给 `BaseTreeProvider` 加了 `capOf` / `raiseCap` 记录每个列表已加载的条数，
  并由 `gitea.loadMore` 命令提升上限后刷新。节点的 `listKey` 带仓库坐标，
  因此不同仓库的同名分组互不干扰。

### 变更

- `gitea.pageSize` 的说明改为「列表类视图**初始**展示多少条」，并在 schema 里补上
  `minimum: 1` / `maximum: 200`。之前 schema 没有任何范围约束、描述只写「分页大小」，
  用户无从知道有效的取值范围与服务端限制；现在也无需靠调大它来「看全」了。

### 新增（仓库视图）

- **按组织分组**：仓库按 owner 归入 `组织名（数量）` 分组，其余按仓库数降序。
- **聚焦当前仓库**：含当前工作区仓库的那一组**置顶 + 默认展开**，该仓库在组内**排第一**
  并标注 `★ 当前`。选这个做法而不是「额外放一个置顶条目」是为了避免同一仓库在树里出现两次。
- **仓库铭牌**（右侧灰色文本）：语言、分支数、开放 Issue / PR 数、`Actions 关闭`、`已归档`。
  计数为 0 的不显示 —— 实测本实例绝大多数仓库的开放 Issue / PR 都是 0，全显示只是噪音。

  > **只使用列表接口已返回的字段，不产生任何额外请求**。因此 `Actions 关闭` 表达的是
  > **功能开关**，**不是**「仓库里没有 workflow 文件」—— 后者需要逐个仓库调
  > `/actions/workflows`，上百个仓库就是上百次请求，不能放在列表渲染路径上。

- **搜索仓库**（视图标题栏）：走**服务端** `/repos/search`，因此覆盖全部仓库，
  不受 `pageSize` / 「加载更多」限制。搜索时结果**平铺不分组**（结果是跨组织的，
  分组反而妨碍扫读），列表首行显示过滤条件且可点击清除，标题栏的清除按钮仅在有过滤时出现
  （用 `setContext` 驱动 `when`）。

  实测记录一处容易踩的：**服务端不按纯 owner 名搜索** —— 搜 `devops` 得 0 个，
  但搜 `devops/cdt-ams` 或 `cdt-ams` 各得 1 个。提示文案与空结果说明都按此写明了。

- 新增 `src/vscode/views/repoBadge.ts`：**刻意不依赖 `vscode` 模块**（与 `icons.ts` 同一约定），
  这样铭牌逻辑能用真实数据离线渲染预览，而不是只能在扩展宿主里跑。

### 工程

- **三个发布通道改为并行 job**，不再是同一个 job 里连续的三步。
  原来串行本身不是大问题，真正的毛病是**任一步失败会让后面的步骤被整体跳过** ——
  例如 Open VSX 出错，会导致 Marketplace 压根不去尝试发布。

  现在拆成四个 job：`resolve`（解析版本 + 判断该版本是否已发）、三个 `publish-*`
  （Open VSX / VS Code Marketplace / GitHub Packages，**并行执行、独立成败**）、
  以及 `release`（建 tag 与 Release）。「市场发布必须先于创建 Release」这条不变，
  由 `needs` 保证 —— 否则重跑时该版本会被判定为「已发」而永远上不了架。

- **Release 说明改从 CHANGELOG 提取**（新增 `scripts/release-notes.mjs`）。
  原先是 `gh release create --generate-notes`，那生成的是**按 commit / PR 自动罗列**的
  摘要，与 CHANGELOG 里那份有分类、有原因、有实测数据的说明完全是两回事 ——
  结果是 Release 页面看不到真正的变更说明。

  现在三者同源：**扩展市场的 Changelog 标签页 / `.vsix` 里的 CHANGELOG / Release 说明**。
  自动摘要原本附带的版本对比链接由脚本补回。

- **新增 `npm run check:changelog`，防止未填写的 CHANGELOG 区块再次发给用户。**
  `scripts/bump-version.mjs` 升版本时会在 CHANGELOG 顶部插入一个「待补充」区块，
  而**它不会自己消失** —— 0.8.1 就是这么把占位文本发到了市场（该条目本次已补上）。
  CHANGELOG 会进 `.vsix`、也会显示在扩展市场的 Changelog 标签页里，
  所以这不是内部问题，而是用户看得见的内容。

  校验两件事：一是没有未填占位（`待补充` / `待填写` / `TODO:` …），
  二是最新版本标题与 `package.json` 的 `version` 一致。
  已接入 `npm run ci`，并且是 CI `verify` job 的一步 —— 依赖链是
  `release → publish-* → package → verify`，因此**能真正挡住发布**，而不只是发个警告。

## [0.8.1] - 2026-09-18

### 变更

- **补齐各处描述文本里遗漏的 Actions**。0.8.0 新增了 Actions 侧边栏视图，
  但对外的文案还停在「仓库 / Issue / PR / 通知」。涉及四处：

  - `package.json` 与 `packages/mcp-server/package.json` 的 `description`
  - `src/ai/mcpConfig.ts` 写入 `.codebuddy/mcp.json` 时用的 MCP Server 说明
  - `src/mcpServer/main.ts` 的 `--help` 用法文本

  > 来源是验证「匿名安装」通路时，肉眼看到 `--help` 输出与实际能力不符 ——
  > 能力已经加上、对外文案没跟上。这类遗漏不影响功能，但 `description` 会直接显示在
  > **扩展市场页面**上，`--help` 会显示在 `npx` 用户的终端里。
  >
  > 本版本发布时该条目未及时补写，留成了占位文本并发到了市场（0.8.1 的
  > Changelog 标签页曾显示「待补充」）。现已补上，并加了 `npm run check:changelog`
  > 防止再次发生 —— 详见 0.8.2 的说明。

## [0.8.0] - 2026-09-18

### 新增

- **新增一条完全匿名的独立包安装路径**：把 MCP 包打成 tarball 作为 GitHub Release 附件发布。

  ```bash
  npx -y https://github.com/Echo-Note/gitea-toolkit/releases/latest/download/gitea-toolkit-mcp.tgz --help
  ```

  背景：0.7.0 把包改发 GitHub Packages 后，用户必须先建 PAT 并写 `~/.npmrc` 才能 `npx`，
  否则会 401。Release 附件下载**是公开免认证的**，而 npm/npx 支持直接执行远程 tarball
  （`npm install <url>` 与 `npx <url>` 均已实测可用），因此补上这条零配置通路。

  附件名**刻意不带版本号**：`releases/latest/download/gitea-toolkit-mcp.tgz` 是稳定地址，
  而 `releases/download/v<版本>/gitea-toolkit-mcp.tgz` 又能精确锁版本 —— 版本信息由 tag 承载。

  GitHub Packages 那条通路**保留不变**（一次性配置后命令更短，适合长期使用）。

### 说明

- 关于「GitHub Packages 不能匿名安装」的完整核实与证据，见 0.7.0 的说明与 README。
  一句话：这不是配置问题，而是 GitHub 对 npm registry 的既定行为 ——
  文档明确要求公开包也要令牌，且**与它自家的 Container registry 相反**（后者公开镜像可匿名拉取）。
  该差异在 GitHub 社区被反复质疑多年（Discussion #33875，2022 起），官方至今无回应、无修复计划。
- 顺带补上一条使用提醒：把该包作为**项目依赖**时，`package-lock.json` 会硬编码 registry 地址，
  提交后他人 `npm install` 会因缺少令牌失败。团队协作场景建议用 Release tarball 那条路。


## [0.7.0] - 2026-09-18

### 新增

- **Actions 侧边栏视图**。0.6.0 只加了 AI 工具，界面上完全看不到 Actions ——
  现在「仓库」视图里每个仓库多一个 **Actions** 分组：

  ```
  仓库 → your-repo
         ├── 分支
         ├── 打开的 Issue
         ├── 打开的 Pull Request
         └── Actions
              ├── 工作流      → 每个工作流（启用/停用用图标区分，点开进浏览器）
              └── 最近运行    → 每次运行（状态图标）→ 展开看作业 → 点作业看日志
  ```

  为什么再分「工作流 / 最近运行」两层而不是直接混排：前者是**定义**、后者是**执行结果**，
  混在一起会让「3 个工作流 + 37 次运行」看起来像 40 个同类条目。

  配套命令（右键菜单 / 命令面板）：

  | 命令 | 入口 |
  | --- | --- |
  | `Gitea: 查看作业日志` | 点击作业节点，或右键 → 在编辑器里打开纯文本日志 |
  | `Gitea: 重跑 Actions` | 右键运行节点，可选「整条重跑 / 仅重跑失败作业」 |
  | `Gitea: 触发工作流` | 右键工作流节点，输入 ref（默认填仓库默认分支） |

  运行/作业的状态图标覆盖全部取值：成功 / 失败 / 超时 / 取消 / 跳过 / 进行中（`sync~spin`）/
  排队中 / 未知。

- 新增 `createActionWorkflowNode` / `createActionRunNode` / `createActionJobNode`、
  `actionIcons`、`workflowIcon`、`actionStateIcon`，以及 `nodeUrl.ts` 中对应的地址推导分支。

### 变更

- **独立 MCP 包改发 GitHub Packages，不再依赖 npmjs.org**：
  - 包名由 `gitea-toolkit-mcp` 改为 **`@echo-note/gitea-toolkit-mcp`**
    （GitHub Packages **只接受带 scope 的包名，且只能小写**）
  - CI 用内置 `GITHUB_TOKEN` 发布，**不再需要 `NPM_TOKEN` secret**，
    只需 job 声明 `packages: write`。也就是说这一步现在**开箱即用**，不再是空转的
  - scope→registry 映射与认证放在 `packages/mcp-server/.npmrc`（**包级**）。

    > 之所以不用改 CI 里 `setup-node` 的 `registry-url`：同一个 job 的
    > VS Code Marketplace 步骤要执行 `npx @vscode/vsce`，那是从**公共 registry** 拉取的，
    > 把全局 registry 指向 `npm.pkg.github.com` 会让它拉不到。包级配置互不影响。

  > ⚠️ **代价（必须知道）**：GitHub Packages 的 npm 源**不接受匿名安装**，
  > 官方文档明确写着发布、安装、删除**公开**包同样需要访问令牌。
  > 因此 `npx -y ...` 不再开箱即用，用户需先建 classic PAT（`read:packages`）并写入 `~/.npmrc`。
  > README 已给出完整的一次性配置步骤。

  > 另外**刻意移除了 `--provenance`**：npm 官方说明来源证明目前只支持发布到公共 npm registry，
  > 对 GitHub Packages 至少会被忽略、最坏会直接报错，不做没把握的事。
  > GitHub Packages 自身会记录发布来源仓库；溯源需求另有 `actions/attest-build-provenance` 可用。

### 修复

- `scripts/preview-tree.mjs` 的图标名校验会把 `sync~spin` 误判为拼错。
  `~modifier`（`spin` / `spin-inverse` / `pulse`）是 VS Code 的**动画修饰符**，不是 codicon 名字，
  校验前必须先剥离；同时对未知修饰符显式报错，避免真写错却静默放过。


## [0.6.0] - 2026-09-18

### 新增

- **Gitea Actions 支持（8 个 AI 工具）**，AI 工具总数 27 → 35：

  | 工具 | 说明 | 访问 |
  | --- | --- | --- |
  | `gitea_list_workflows` | 列出仓库的工作流与启用状态 | 只读 |
  | `gitea_list_action_runs` | 列出运行记录，可按事件 / 分支 / 状态 / 触发者 / 提交 SHA 过滤 | 只读 |
  | `gitea_get_action_run` | 运行详情 + 全部作业及步骤状态，并直接指出失败的作业 | 只读 |
  | `gitea_get_job_logs` | 作业原始日志（**默认只保留末尾**若干行） | 只读 |
  | `gitea_list_artifacts` | 列出构建产物（含大小与是否过期） | 只读 |
  | `gitea_dispatch_workflow` | 手动触发 `workflow_dispatch`，可传 inputs | 写入 |
  | `gitea_rerun_action` | 重跑整条运行，或只重跑失败作业 | 写入 |
  | `gitea_set_workflow_enabled` | 启用 / 停用工作流 | 写入 |

  新增 `ActionOperations`（`src/core/operations/actions.ts`）、
  5 个 Actions 实体类型、`runWebUrl` / `workflowWebUrl`。

### 说明

- **日志取的是末尾而非开头**：作业日志动辄上千行，而出错信息几乎总在最后，
  因此 `gitea_get_job_logs` 默认保留最后 200 行（可用 `tail_lines` 调整）。
- **刻意没有「取消运行」**：Gitea 1.26.4 的 API **不提供取消接口**，
  只有 `rerun` / `rerun-failed-jobs`。`DELETE /actions/runs/{run}` 是**删除记录**，
  语义完全不同，因此没有包装成「取消」暴露给 AI。
- **产物只列不下载**：下载是 zip 二进制流，不适合作为工具返回值；
  需要时用返回里的 `archive_download_url` 或走网页。
- 写操作（dispatch / rerun / 启停）在 VS Code 语言模型工具路径下**会自动弹确认卡片**，
  机制与既有的 `gitea_create_*` 一致（由工具定义的 `access: 'write'` 驱动，无需额外配置）。

### 验证

- 全部接口对**真实实例实调通过**（Gitea 1.26.4）：`listWorkflows` 3 个、
  `listRuns` 5 条、`getRun`、`listRunJobs` 6 个作业（含 steps）、
  `getJobLogs` 782 字符文本解析正常、`listArtifacts` 空结果路径正常。
- 字段与路径逐一核对了实例的 `/swagger.v1.json`。


## [0.5.1] - 2026-09-18

### 变更

- README「安装」一节补上两个市场的**直达页面链接**，并提示可直接在扩展面板搜索
  `Gitea Toolkit`。

### 工程

- **本版本的主要目的是验证 VS Code Marketplace 发布通道**：仓库 secret `VSCE_PAT`
  配置完成（`vsce verify-pat echo-note` 已确认令牌对该 publisher 有发布权），
  本版本是首次经 CI 自动上架微软官方市场。

  > 发布链路的顺序与幂等设计见「发布到扩展市场」一节；
  > ⚠️ 该令牌属 Azure DevOps **全局 PAT**，此类令牌将于 **2026-12-01 停用**，届时需迁移到 Entra ID。


## [0.5.0] - 2026-09-18

### 修复

- **恢复扩展自身的更新检查**，并修正它此前会与市场更新「打架」的根因。

  0.4.0 曾以「会造成第二个『最新版本』口径、与市场提示矛盾」为由整体移除该功能。
  但那个前提已经变了：0.4.0 起 CI 在**同一个 job** 里把同一个版本发到
  Open VSX、VS Code Marketplace 与 GitHub Releases，**GitHub 不再系统性领先市场**；
  而移除之后留下了一个真实缺口 —— **手动装 `.vsix` 的用户永远收不到任何更新提醒**
  （这类安装不被编辑器跟踪）。

  恢复的同时做了两处改进：

  - **提示文案改为渠道中性**：由「下载 .vsix」改为
    「从扩展市场安装的会自动更新，无需操作；手动装的 .vsix 需下载新版本」，
    不再引导市场用户去手动下载。按钮顺序也改为「查看变更」在前。
  - **不再有 `UPDATE_CHANNEL` 常量**（按要求移除）。它原本依赖「编译期写死渠道」，
    而实测渠道**根本不可检测**（见下），保持写死反而会掩盖真实的分发方式。

### 说明

- **安装渠道探测是不可行的，已实测确认**：VS Code 没有公开 API 能判断扩展的安装来源；
  内部的 `extensions.json` 里 `metadata.source` 实测**一律为 `gallery`** ——
  两个客户端共 54 个扩展全部如此，**包括明确用 `--install-extension <vsix>` 安装的那一个**。

  因此改用**版本比对**达到「按渠道分流」的同等效果，且不依赖任何探测：

  - 市场安装的：编辑器把它更新到最新后，检查自然得出「已是最新」→ 静默
  - 手动安装的：版本一直停在旧的 → 提示

### 新增（恢复）

- 命令 `Gitea: 检查更新`（`gitea.checkForUpdates`）
- 配置项 `gitea.checkUpdates`（默认开启）
- 激活后每天自动检查一次；「上次检查时间」**只在请求成功后写入**，
  同一个新版本只提示一次，除手动触发外任何失败都只写日志
- 状态栏菜单里的「检查扩展更新」

> **扩展无法自我更新** —— 更新动作只能由编辑器执行。本检查的作用是**发现并提示**，
> 对市场安装的用户只是「提前知道」，对 `.vsix` 安装的用户才是唯一的更新入口。


## [0.4.0] - 2026-09-18

### 变更（含移除）

- **移除内置的「检查扩展自身更新」功能**。扩展已同时上架 Open VSX 与 VS Code Marketplace，
  两个渠道都由编辑器自动更新，内置一套比对 GitHub Releases 的检查只会产生**第二个「最新版本」口径** ——
  市场与 GitHub 不同步时会给出互相矛盾的提示，反而误导用户。

  随之移除：
  - 命令 `Gitea: 检查更新`（`gitea.checkForUpdates`）
  - 配置项 `gitea.checkUpdates`
  - 常量 `UPDATE_CHANNEL` 及 `src/vscode/updateChecker.ts`、`src/core/selfUpdate.ts`、
    `src/vscode/commands/updateCommands.ts`
  - 状态栏菜单里的「检查扩展更新」

  > **从 Releases 手动装 `.vsix` 的用户不再收到更新提醒** —— 这类安装本来就不被编辑器跟踪。
  > 需要持续更新请改用市场安装（见 README「安装」）。
  >
  > 保留的 `Gitea: 检查版本兼容性` 是**另一件事**：它查的是服务端 Gitea 版本与扩展已核对版本的差异，
  > 与扩展自身是否最新无关。

### 新增

- **CI 增加 VS Code Marketplace 发布**，与 Open VSX 并列。`release` job 现在依次发布到两个市场，
  最后才创建 GitHub Release 作为「本次发版完成」的标记 —— 顺序不可颠倒（原因见 workflow 注释）。
  启用方式：配置仓库 secret `VSCE_PAT`（未配置时静默跳过，不阻断发版）。

  > ⚠️ **认证方式有硬时限**：Marketplace 要求 PAT 的 Organization 必须是
  > *All accessible organizations*，而 Azure DevOps 的**全局 PAT 将于 2026-12-01 完全停用**，
  > 正是这一类。届时需迁移到 Entra ID（`vsce publish --azure-credential`，
  > 需 Azure 订阅 + 托管标识 + 服务连接）。运行时若走 PAT 路径，步骤会打印一条迁移提醒。

### 工程

- Marketplace 发布步骤同样做了幂等与容错：发布前查询该版本是否已存在；
  查询失败时**保守放行**（真正的重复由 `--skip-duplicate` 兜住），发布报错后复查再判定。
- README 的「安装」「更新扩展」「发布到扩展市场」三节按双市场的事实重写，
  并明确写出「手动装 vsix 不会被市场自动更新」这一容易踩的预期落差。


## [0.3.3] - 2026-09-18

### 修复

- **27 个语言模型工具全部注册失败。** VS Code 报：

  ```
  CANNOT register tool with invalid id: giteaToolkit.gitea_list_repos.
  The id must match /^[\w-]+$/
  ```

  原因：`vscode.lm.registerTool` 的 ID 与 `contributes.languageModelTools[].name`
  都不允许点号，而我们的前缀写的是 `giteaToolkit.`。
  改为 `giteaToolkit_`，工具 ID 形如 `giteaToolkit_gitea_list_repos`
  （`toolReferenceName` 仍是 `gitea_list_repos`，用户 `#` 引用方式不变）。

  这个 bug 之所以能一直藏到线上：前缀在 `ai/lmTools.ts` 与 `ai/tools/index.ts` 里**各写了一遍**，
  靠注释约定同步；而 `sync-tools.mjs` 会校验工具名却**没校验这个 ID**，
  于是 package.json、类型检查、Lint 三处都发现不了。

### 工程

- 新增 `src/ai/ids.ts`，把两类标识符收敛为**单一定义**（该模块不依赖 vscode，
  因此构建脚本能直接加载并与 package.json 比对）。
- `scripts/sync-tools.mjs` 增加两类防漂移校验：
  - 每个 `languageModelTools[].name` 必须匹配 `/^[\w-]+$/` 且使用约定前缀
  - `mcpServerDefinitionProviders[].id` 必须与代码常量一致

  两者都已用「故意改坏 → 确认校验失败 → 还原」反向验证过，不是加了就算。
- `MCP_PROVIDER_ID` 由 `giteaToolkit.mcp` 改为 `giteaToolkit_mcp`。官方文档示例用的是
  `exampleProvider` 这种裸标识符，未示范点分格式，也未公开字符集规则 ——
  既然该路径从未在真实 VS Code 上验证过，不做未经证实的假设。

### 说明

- README 中示例的 ID 写法已同步更新。


## [0.3.2] - 2026-09-18

### 修复

- **设置访问令牌后，侧边栏要手动刷新一次才会出现仓库。**

  原因：视图刷新**唯一**的触发来源是 `SecretStorage.onDidChange`。该事件由存储层派发，
  与写入真正生效之间**时序不确定** —— 事件可能在密钥可读之前触发，
  此时 `ensureClient()` 拿不到令牌，视图就渲染成「尚未设置访问令牌」；
  手动刷新时密钥已可读，仓库才出来。这解释了「手动刷新有效、自动刷新无效」的差异。

  修法是不再依赖存储事件的时序，由命令在 `await setToken(...)` **之后**显式调用
  新增的 `GiteaService.notifyChanged()`，刷新时机因此是确定的。
  同时保留 `secrets.onDidChange` 订阅作为兜底（本扩展是 SecretStorage 的唯一写入方，
  正常路径已不再依赖它）。

### 变更

- `Gitea: 刷新所有视图` 改为调用 `service.notifyChanged()`，与自动刷新**共用同一段代码**。
  原先手动刷新在命令里自己循环调用 `provider.refresh()`、自动刷新走 `onDidChange`，
  两条路径本质相同却是两份实现 —— 这正是本次「手动有效、自动无效」得以存在的原因。
  合并后不会再出现这类行为分叉。
- 刷新时新增一条 debug 日志，便于再次出现时定位。

### 说明

- 手动刷新（`Gitea: 刷新所有视图`）与自动刷新现在完全等价，可作为临时规避手段。


## [0.3.1] - 2026-09-18

### 变更

- **`UPDATE_CHANNEL` 由 `'github'` 改为 `'marketplace'`**。扩展已在 Open VSX 上架，
  CodeBuddy 等客户端会自动更新，此时内置的自动更新检查只会造成两条通道互相矛盾的提示
  （编辑器已静默更新，扩展还提示「去 GitHub 下载 .vsix」）。
  手动执行 `Gitea: 检查更新` 不受影响，仍可用，结果里会注明比对的是 GitHub Releases 的版本。
- 文档同步：README 的「更新扩展」「配置项」两处原本写着「未发布到 Marketplace、编辑器不会自动更新」，
  已按上架后的实际情况改写。

### 说明

- 本次也是 **CI 全自动发布链路的首次真实验证**。0.3.0 是手工用 `ovsx publish` 发的，
  未经 CI；本次由 `release` job 自动发布到 Open VSX，同时产出 GitHub Release 与 `SHA256SUMS`。


## [0.3.0] - 2026-09-18

### 新增

- **MCP Server 独立为 npm 包 `gitea-toolkit-mcp`**，不再只能作为扩展的一部分使用。
  Claude Desktop、Cursor 等任何支持 stdio 的 MCP 客户端现在可以直接接入，**无需安装 VS Code 扩展**：

  ```bash
  npx -y gitea-toolkit-mcp --url https://gitea.example.com --token <令牌>
  ```

  实际上服务端代码早在最初就与 VS Code 完全解耦（`src/core`、`src/ai/tools`、`src/mcpServer`
  均不引用 `vscode`），缺的只是打包与发布 —— 此前它只作为 `.vsix` 里的一个文件存在，
  外部拿不到。
- MCP Server 新增**命令行参数**：`--url`、`--token`、`--no-verify-tls`、`--timeout`、
  `--max-output`、`--help`、`--version`。独立使用时不必再被迫走环境变量；
  **命令行参数优先于环境变量**，两者都保留（扩展内置路径继续用环境变量，行为不变）。

### 工程

- **构建一次、复制两份**：`esbuild.js` 把 MCP Server 构建为 `dist/mcpServer.js` 后，
  复制一份到 `packages/mcp-server/dist/index.js`。刻意不分别构建 —— 两条分发通道
  （扩展内置 / 独立 npm 包）的代码必须一致，分别构建会有漂移风险。
  复制时会去掉行尾 `sourceMappingURL`（避免指向不存在的 `.map`）并补 shebang + 可执行位
  （npm 的 `bin` 在 Unix 下是符号链接，没有 shebang 跑不起来）。
- `scripts/bump-version.mjs` 同步 npm 包的版本号，两个包**共用一个版本号**（同一次构建产出，
  分叉后没人说得清哪个 npm 版本对应哪个扩展版本）。CI 发布前还会再校验一次，不一致直接失败。
- CI 的新增「发布到 npm」步骤：secret 名为 **`NPM_TOKEN`**，未配置时静默跳过、不阻断发版；
  幂等（`npm view` 判重）；带 `--provenance` 附上产物来源证明，用户可核对包确实由本仓库哪次
  workflow / commit 构建 —— 对要 `npx` 执行本地代码的场景尤其重要。

### 说明

- npm 包**零依赖**：所有依赖已打进单个 bundle，`npx` 下载后直接运行，没有依赖安装步骤。
- 该步骤的 shell 同样被抽取出来跑了六条分支（未配置 secret / 版本已存在 / 版本不一致 /
  缺少产物 / 发布失败 / 发布报错但复查发现已存在）。
- 注意 `--help` 与 `--version` 之外**不允许向 stdout 写任何东西** —— stdio 模式下 stdout 归
  MCP 协议所有，混入杂输出会让客户端直接解析失败。已在三组场景下实测 stdout 全部是合法 JSON-RPC。


## [0.2.1] - 2026-09-17

### 新增

- **补齐上架扩展市场所需的清单**：新增 `icon`（`media/icon.png`，256×256 PNG）。
  此前 `package.json` 没有 `icon` 字段，而 `vsce` **拒收 SVG 图标**、要求 ≥128×128 的 PNG，
  相当于上架硬阻断。活动栏那个 24×24 单色 SVG 不能直接复用（它靠 `currentColor` 跟随主题，
  不是给市场展示用的），故单独绘制了带底色的版本；`media/icon.svg` 保留为可编辑源文件。

### 变更

- 新增 `UPDATE_CHANNEL` 常量（`src/vscode/updateChecker.ts`），用来隔离两条更新通道。
  上架市场后把它改成 `'marketplace'` 即可关闭内置的自动检查 —— 否则编辑器已从市场自动更新，
  扩展还会另提示「去 GitHub 下载 .vsix」，两条通道互相打架。
  用编译期常量而非运行时探测，是因为 VS Code **没有公开 API 能判断扩展的安装来源**
  （Marketplace / 手动装 VSIX / 开发模式都落在同一个 `extensions/` 目录下）。
  手动检查不受影响，但会注明「比对的是 GitHub Releases 的版本」。
- `npm run package` 移除 `--allow-missing-repository`（`repository` 已声明）。

### 文档

- 新增「发布到扩展市场」一节。**关键结论**：CodeBuddy（CN 与国际版）的扩展源是
  **Open VSX** 而非 MS Marketplace（`product.json` 的 `extensionsGallery.serviceUrl`
  指向 `open-vsx.org`），只发 MS Marketplace 的话 CodeBuddy 用户看不到这个扩展。
  文中给出两个市场的发布命令、三个坑（publisher 不可改、`vsce publish` 自建 tag 会与 CI 冲突、
  Azure DevOps PAT 于 2026-12-01 退役）。
- 更正 `repository` 字段的说明：0.1.4 曾刻意移除它并改用 `--allow-missing-repository`，
  0.2.0 又加了回来，两处文档此前互相矛盾，现已写明理由与取舍。

### 工程

- **CI 接入 Open VSX 自动上架**。因 CodeBuddy 的扩展源是 Open VSX，这已不只是「可选优化」，
  而是主要分发通道。`release` job 新增「发布到 Open VSX」步骤：
  - 未配置 `OVSX_PAT` secret 时静默跳过、不阻断发版，因此可先合入、拿到 token 后再补 secret；
    secret 存在时任何发布失败都会让 job 失败，不会造成「以为已上架」的错觉
  - **刻意排在创建 Release 之前**：本 job 以「Release 是否存在」判断该版本是否已发，
    若先建 Release 再发市场，市场一旦失败，重跑会被整体跳过，该版本将永远上不了架；
    这个顺序可以自愈
  - 幂等：发布前查 `/api/<ns>/<name>/<版本>`，已存在则跳过；发布报错后复查再判定
    —— 该接口在「扩展不存在」时返回 **503 而非 404** 且偶发抖动，不能只看退出码
- 该步骤的 shell 已被单独抽取出来跑过四条分支（未配置/空值/已存在/不存在）验证，
  过程中发现并修掉一个真实 bug：脚本开了 `set -u`，而 `${OVSX_PAT}` 在变量
  **未定义**（而非空值）时会直接中断，已改为 `${OVSX_PAT:-}`。
- 注意：本改动不影响扩展产物，**未做版本递增**；该步骤要到下一次版本递增才会真正执行。


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
