"""工具注册入口：把各域的工具挂到 MCPServer 上。

与 TS 版一致，工具名（``gitea_*``）跨实现保持相同，因此同一份提示词在
TypeScript 版与 Python 版之间可以互换。
"""

from __future__ import annotations

from typing import Any

from . import account_tools, action_tools, issue_tools, pull_tools, repo_tools


def register_all(server: Any) -> None:
    """注册全部工具域。

    新增域时在这里挂上即可；工具名重复会被 SDK 警告（``warn_on_duplicate_tools``），
    所以漏改这里会立刻暴露，而不是静默少注册。
    """
    account_tools.register(server)
    action_tools.register(server)
    issue_tools.register(server)
    pull_tools.register(server)
    repo_tools.register(server)


__all__ = ["register_all"]
