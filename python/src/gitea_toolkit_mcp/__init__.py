"""Gitea Toolkit 的 MCP 工具服务（Python 实现）。

与 TypeScript 版（`packages/mcp-server`）**同源同语义**：工具名、参数、返回文本、
错误归一化都刻意保持一致，两个实现可互换使用。

必须遵守的约定（破坏任何一条都会让客户端解析不了协议）：

- **stdout 只用于 MCP 协议报文**，任何诊断信息一律走 stderr；
- `--help` / `--version` 是显式用户命令，此时才允许写 stdout 并退出；
- 配置来源：命令行参数优先于环境变量。
"""

__all__ = ["__version__"]

# 由 scripts/bump-version.mjs 与 package.json 保持同步；此处是兜底值
__version__ = "0.9.1"
