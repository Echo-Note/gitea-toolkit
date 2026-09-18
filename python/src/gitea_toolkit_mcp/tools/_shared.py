"""工具层的共享上下文与格式化助手。

为什么用模块级上下文：MCPServer 的工具是普通函数（FastMCP 风格），注册时无法携带
额外对象；而本服务是**单进程 stdio**，一个上下文足够。装配时由 ``build_server`` 注入。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from pydantic import Field

from ..client import GiteaClient
from ..repo_ref import RepoRef, resolve_repo_ref

#: ``owner`` / ``repo`` 两个入参的公共片段。
#:
#: 放在这里而不是各工具模块各写一遍：这两段文案必须**逐字一致** ——
#: 同一个字段在 Issue 域与 PR 域显示出不同描述，会让模型对「省略会怎样」产生分歧。
OWNER_ARG = Annotated[
    str | None,
    Field(description="仓库所属者（用户名或组织名）。省略时使用当前工作区推断出的仓库。"),
]
REPO_ARG = Annotated[
    str | None,
    Field(description="仓库名。省略时使用当前工作区推断出的仓库。"),
]


@dataclass
class ToolContext:
    """工具执行所需的一切。"""

    client: GiteaClient
    server_url: str
    max_output_length: int

    def truncate(self, text: str) -> str:
        """按配置上限截断输出，并明确告知被截断（而不是静默丢失）。"""
        limit = self.max_output_length
        if limit <= 0 or len(text) <= limit:
            return text
        return (
            text[:limit]
            + f"\n…（输出超过 {limit} 字符已截断；可调大 --max-output / GITEA_MAX_OUTPUT_LENGTH）"
        )


_context: ToolContext | None = None


def set_context(context: ToolContext) -> None:
    """装配时注入上下文。"""
    global _context
    _context = context


def ctx() -> ToolContext:
    """取当前上下文；未装配时说明是内部错误而不是抛裸异常。"""
    if _context is None:
        raise RuntimeError("工具上下文尚未初始化（内部错误：build_server 未先调用 set_context）")
    return _context


def resolve_repo(owner: str | None, repo: str | None) -> RepoRef:
    """解析本次调用作用在哪个仓库（显式参数优先，其次从工作目录的 git origin 推断）。

    Raises:
        ValueError: 既没显式给全、也无法从工作目录推断时
    """
    return resolve_repo_ref(owner, repo, ctx().server_url)


def relative_time(value: str | None) -> str:
    """把 ISO 时间转成「3 天前」这类相对表述；解析不了就原样返回。"""
    if not value:
        return ""
    from datetime import datetime, timezone

    normalized = value.replace("Z", "+00:00")
    try:
        moment = datetime.fromisoformat(normalized)
    except ValueError:
        return value
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    delta = datetime.now(timezone.utc) - moment
    seconds = int(delta.total_seconds())
    if seconds < 0:
        return "刚刚"
    if seconds < 60:
        return f"{seconds} 秒前"
    if seconds < 3600:
        return f"{seconds // 60} 分钟前"
    if seconds < 86400:
        return f"{seconds // 3600} 小时前"
    if seconds < 86400 * 30:
        return f"{seconds // 86400} 天前"
    return moment.strftime("%Y-%m-%d")


__all__ = [
    "OWNER_ARG",
    "REPO_ARG",
    "ToolContext",
    "ctx",
    "relative_time",
    "resolve_repo",
    "set_context",
]
