"""工具注册助手与注解预设。

**为什么参数名用 camelCase**：本包与 TS 版（`packages/mcp-server`）刻意保持**接口一致** ——
同一句提示、同一份客户端配置，在任一实现下都能工作。因此参数名、默认值、语义都对齐 TS 版的
`inputShape`（例如 `filePath` / `newBranch` / `autoInit`），而不是改成 Python 惯用的下划线。

**为什么异常要包成 `ToolError`**：MCP Python SDK v2 里，工具函数抛出的**其他任何异常**
都会被替换成一句固定的 ``Error executing tool <名字>``——原始文案**刻意不外泄**
（设计上认为那是服务端内部信息）。后果是：我们精心写的中文报错（「必须提供 filePath」、
「权限不足，当前令牌…」）**一个字都到不了模型**，模型只能看到一个英文句子，无法自我纠正。
所以统一在装饰器里把异常转成 ``ToolError``，让可读原因真的能传出去。
"""

from __future__ import annotations

import functools
from typing import Any
from collections.abc import Callable

from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

from ..errors import describe_error

#: 只读工具：不修改任何远端数据
READ_ONLY = ToolAnnotations(read_only_hint=True, idempotent_hint=True, open_world_hint=True)

#: 写工具：会**覆盖或删除既有内容**（改 Issue 正文、覆盖文件、合并 PR、改工作流开关）
WRITE = ToolAnnotations(read_only_hint=False, destructive_hint=True, open_world_hint=True)

#: 增量写工具：只**新增**内容，不动既有数据（建 Issue / 评论 / 提 PR / 触发工作流…）
#:
#: 单列一档是有意的：规范里 ``destructiveHint=false`` 的含义就是「仅做增量更新」。
#: 若把「创建 Issue」也标成破坏性，客户端会在每次调用前弹确认 —— 既吓人又降低安全性
#: （用户被无意义的确认框训练成无脑点「同意」）。
WRITE_ADDITIVE = ToolAnnotations(
    read_only_hint=False, destructive_hint=False, open_world_hint=True
)

#: 幂等写工具：重复执行结果相同（例如「标记通知已读」）
WRITE_IDEMPOTENT = ToolAnnotations(
    read_only_hint=False,
    destructive_hint=False,
    idempotent_hint=True,
    open_world_hint=True,
)


def tool(
    server: Any,
    *,
    name: str,
    title: str,
    read_only: bool = True,
    idempotent: bool = False,
    destructive: bool = True,
) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """按「只读 / 增量写 / 幂等写 / 破坏写」四档注册工具。

    工具函数用 **docstring 作为 description**（直接复用 TS 版的中文 description）。

    Args:
        server: MCPServer 实例
        name: MCP 工具名（与 TS 版 ``toolReferenceName`` 一致）
        title: 人类可读名（与 TS 版 ``displayName`` 一致）—— 规范里是可选字段，
            但客户端（授权确认窗、工具列表）更常显示它，且 TS 版有，故**必填**，
            由测试保证不漏。
        read_only: 是否只读
        idempotent: 写操作是否幂等
        destructive: 写操作是否会覆盖 / 删除既有内容（只读时忽略）
    """
    if read_only:
        preset = READ_ONLY
    elif idempotent:
        preset = WRITE_IDEMPOTENT
    elif destructive:
        preset = WRITE
    else:
        preset = WRITE_ADDITIVE
    # annotations 也带 title：TS 版两个都写，保持一致
    annotations = preset.model_copy(update={"title": title})

    def decorate(fn: Callable[..., Any]) -> Callable[..., Any]:
        @functools.wraps(fn)  # 保留签名 —— SDK 据此生成 inputSchema（含 required）
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            try:
                return await fn(*args, **kwargs)
            except Exception as error:  # noqa: BLE001 - 统一转成模型可读的 ToolError
                raise ToolError(describe_error(error)) from error

        return server.tool(name=name, title=title, annotations=annotations)(wrapper)

    return decorate


__all__ = [
    "READ_ONLY",
    "WRITE",
    "WRITE_ADDITIVE",
    "WRITE_IDEMPOTENT",
    "tool",
]
