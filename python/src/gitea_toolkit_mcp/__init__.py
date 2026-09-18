"""Gitea Toolkit 的 MCP 工具服务（Python 实现）。

与 TypeScript 版（`packages/mcp-server`）**同源同语义**：工具名、参数、返回文本、
错误归一化都刻意保持一致，两个实现可互换使用。

必须遵守的约定（破坏任何一条都会让客户端解析不了协议）：

- **stdout 只用于 MCP 协议报文**，任何诊断信息一律走 stderr；
- `--help` / `--version` 是显式用户命令，此时才允许写 stdout 并退出；
- 配置来源：命令行参数优先于环境变量。
"""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as _distribution_version

__all__ = ["__version__"]

#: 本包版本号。
#:
#: **从已安装的分发包元数据里读**，而不是再写一份常量。此前这里是
#: `__version__ = "0.9.1"` 并注明「由 scripts/bump-version.mjs 保持同步」——
#: 而那个脚本只改 package.json / npm 包 / pyproject.toml，**根本不改这个文件**。
#: 后果在真实安装验证时才暴露：`uvx gitea-toolkit-mcp@0.9.2 --version` 打印的是 0.9.1，
#: MCP 客户端看到的 serverInfo.version 也是旧的。
#: 少一份副本，就少一处「能忘记同步」的地方 —— 这是第 4 处版本号，直接删掉。
try:
    __version__ = _distribution_version("gitea-toolkit-mcp")
except PackageNotFoundError:  # 源码树里直接跑（未安装成分发包）时的兜底
    __version__ = "0.0.0+source"
