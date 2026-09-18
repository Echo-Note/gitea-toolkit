# gitea-toolkit-mcp

Gitea 的 [MCP](https://modelcontextprotocol.io/) 工具服务（stdio 传输）。
**独立运行，不需要安装 VS Code 扩展**，任何 MCP 客户端都能接入。

提供 **27 个工具**，覆盖仓库、Issue、Pull Request、通知的读写，例如：

- 列出 / 搜索仓库、读取文件与提交历史
- 新建、查询、更新、评论、关闭 Issue
- 创建 PR、查看 diff 与变更文件、批准 / 请求修改 / 合并、检出分支
- 查询提交的 CI 合并状态
- 读取与标记通知

## 快速开始

```bash
npx -y gitea-toolkit-mcp --url https://gitea.example.com --token <你的访问令牌>
```

不需要令牌就能先看看有什么工具：

```bash
npx -y gitea-toolkit-mcp --help
```

访问令牌在 Gitea 的 **「设置 → 应用 → 生成令牌」** 创建，勾选 `repo`、`issue`、`notification` 权限。

## 配置

命令行参数优先于环境变量，两者都支持 —— 按你所用客户端的习惯挑一种即可。

| 命令行参数 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--url <地址>` | `GITEA_SERVER_URL` | 无（必填） | Gitea 实例地址 |
| `--token <令牌>` | `GITEA_TOKEN` | 无 | 访问令牌；不提供则只能读公开内容 |
| `--no-verify-tls` | `GITEA_VERIFY_TLS=false` | 校验 | 跳过 HTTPS 证书校验，用于内网自签名证书 |
| `--timeout <毫秒>` | `GITEA_TIMEOUT_MS` | `20000` | 请求超时 |
| `--max-output <字符>` | `GITEA_MAX_OUTPUT_LENGTH` | `100000` | 单次工具返回的文本上限（超出会截断） |

`--help` / `--version` 分别打印用法与版本号。

## 客户端配置

### Claude Desktop

编辑 `claude_desktop_config.json`（macOS 在 `~/Library/Application Support/Claude/`）：

```json
{
  "mcpServers": {
    "gitea": {
      "command": "npx",
      "args": ["-y", "gitea-toolkit-mcp", "--url", "https://gitea.example.com"],
      "env": { "GITEA_TOKEN": "你的访问令牌" }
    }
  }
}
```

### Cursor

`.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "gitea": {
      "command": "npx",
      "args": [
        "-y", "gitea-toolkit-mcp",
        "--url", "https://gitea.example.com",
        "--token", "你的访问令牌"
      ]
    }
  }
}
```

### 其它客户端

只要支持 stdio 型 MCP Server，用 `npx -y gitea-toolkit-mcp` 作为启动命令、
上面那张表里的参数作为入参即可。

## 关于仓库参数

**多数工具不必显式传 `owner` / `repo`** —— 服务会从**当前工作目录的 git 远端**推断仓库
（`origin` 指向该 Gitea 实例时生效，SSH 与 HTTP(S) 两种形式都支持）。
所以在 Gitea 仓库目录下启动，可以直接说「列出最近的 Issue」而不必重复仓库名。

推断不出来时（例如工作目录不在任何 git 仓库里），传 `owner` / `repo` 即可。

## 说明

- **零依赖**：发布包是单个已打包的 JS 文件，`npx` 下载后直接运行，不会有依赖安装步骤，
  启动也更快。
- **写操作有风险**：新建 Issue、合并 PR、提交文件等会真实改动 Gitea 数据。
  请确认你所用的客户端支持工具调用确认机制（VS Code 扩展会强制弹确认框）。
- **令牌存放**：无论写在 `args` 还是 `env` 里，令牌都以明文存在客户端的配置文件中。
  请确保该文件权限合适、不要提交进版本库。
- 仅支持 **stdio** 传输，没有 HTTP/SSE 模式。

## 与 VS Code 扩展的关系

本包与 [Gitea Toolkit 扩展](https://marketplace.visualstudio.com/search?term=gitea-toolkit)
**同源**：共用同一份 `core` 与工具定义，同一次构建产出，两边行为一致。

装了扩展就不需要本包 —— 扩展已内置 MCP Server，并会自动出现在支持 MCP 的编辑器里。

## 许可证

MIT
