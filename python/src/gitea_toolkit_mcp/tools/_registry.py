"""工具注册助手与注解预设。

**为什么参数名用 camelCase**：本包与 TS 版（`packages/mcp-server`）刻意保持**接口一致** ——
同一句提示、同一份客户端配置，在任一实现下都能工作。因此参数名、默认值、语义都对齐 TS 版的
`inputSchema`（例如 `filePath` / `newBranch` / `autoInit`），而不是改成 Python 惯用的下划线。
"""

from __future__ import annotations

from typing import Any, Callable

from mcp.types import ToolAnnotations

#: 只读工具：不修改任何远端数据
READ_ONLY = ToolAnnotations(read_only_hint=True, idempotent_hint=True, open_world_hint=True)

#: 写工具：会真实改动 Gitea 数据
WRITE = ToolAnnotations(read_only_hint=False, destructive_hint=True, open_world_hint=True)

#: 幂等写工具：重复执行结果相同（例如「标记通知已读」）
WRITE_IDEMPOTENT = ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=True, open_world_hint=True)


def tool(
    server: Any,
    *,
    name: str,
    read_only: bool = True,
    idempotent: bool = False,
) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """按「只读 / 写 / 幂等写」三档注册工具。

    工具函数用 **docstring 作为 description**（直接复用 TS 版的中文 modelDescription），
    异常交给 SDK 包装成 ``is_error`` —— 我们的错误类型 ``__str__`` 本身就是中文友好文案，
    所以工具里不需要写 try/except。

    Args:
        server: MCPServer 实例
        name: MCP 工具名（与 TS 版 ``toolReferenceName`` 一致）
        read_only: 是否只读
        idempotent: 写操作是否幂等
    """
    if read_only:
        annotations = READ_ONLY
    elif idempotent:
        annotations = WRITE_IDEMPOTENT
    else:
        annotations = WRITE
    return server.tool(name=name, annotations=annotations)


__all__ = ["READ_ONLY", "WRITE", "WRITE_IDEMPOTENT", "tool"]
