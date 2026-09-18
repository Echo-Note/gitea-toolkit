"""账户域工具：当前用户、组织、通知（对应 TS 版 `src/ai/tools/accountTools.ts`）。"""

from __future__ import annotations

from typing import Annotated, Any, Literal
from collections.abc import Sequence

from pydantic import Field

from ..operations import AccountOperations
from ..version import compatibility_status_line, evaluate_compatibility
from ._format import relative_time
from ._registry import tool
from ._shared import ctx


def register(server: Any) -> None:
    """注册账户域工具。"""

    @tool(server, name="gitea_get_current_user", title="获取当前用户")
    async def gitea_get_current_user() -> str:
        """获取当前访问令牌对应的 Gitea 用户信息。也可用于校验令牌是否有效、实例是否可连通。"""
        c = ctx()
        operations = AccountOperations(c.client)
        user = await operations.current_user()
        # 版本一并交代：这个工具的定位就是「令牌 / 连通性 / 环境自查」，
        # 顺手把服务端版本与兼容性说清楚，省得用户另开一次提问。
        # 取不到版本不影响本工具（与自动探测同一态度）。
        try:
            compat = evaluate_compatibility(await operations.server_version())
        except Exception:  # noqa: BLE001 - 版本是附加信息，取不到也要能自查令牌
            compat = None
        lines = [
            # 字段与 TS 版**逐字对齐**（对齐前 Python 用的是 full_name、且缺主页/注册时间）
            f"# @{user.get('login')}",
            "",
            f"- 昵称：{user.get('full_name') or '-'}",
            f"- 邮箱：{user.get('email') or '-'}",
            f"- 管理员：{'是' if user.get('is_admin') else '否'}",
            f"- 主页：{user.get('html_url') or '-'}",
            f"- 注册时间：{relative_time(user.get('created'))}",
            f"- 实例：{c.server_url}",
            f"- 服务端版本：{compatibility_status_line(compat)}",
        ]
        return c.truncate("\n".join(lines))

    @tool(server, name="gitea_list_orgs", title="列出组织")
    async def gitea_list_orgs() -> str:
        """列出当前用户所属或可见的 Gitea 组织。"""
        c = ctx()
        orgs = await AccountOperations(c.client).list_orgs()
        if not orgs:
            return "当前用户不属于任何组织。"
        lines = [f"- **{org.get('username') or org.get('name')}**" for org in orgs]
        return c.truncate(f"共 {len(orgs)} 个组织：\n" + "\n".join(lines))

    @tool(server, name="gitea_list_notifications", title="列出通知")
    async def gitea_list_notifications(
        includeRead: Annotated[
            bool | None, Field(description="是否包含已读通知，默认 false。")
        ] = None,
        subjectTypes: Annotated[
            Sequence[Literal["issue", "pull", "commit", "repository"]] | None,
            Field(description="仅关注的通知类型。"),
        ] = None,
        limit: Annotated[int | None, Field(ge=1, le=100, description="返回数量上限，默认 30。")] = None,
    ) -> str:
        """列出当前用户的 Gitea 通知线程，可按类型过滤。"""
        c = ctx()
        result = await AccountOperations(c.client).list_notifications(
            include_read=includeRead,
            subject_types=subjectTypes,
            limit=limit or 30,
        )
        if not result.items:
            return "没有通知。"
        lines: list[str] = []
        for thread in result.items:
            subject = thread.get("subject") or {}
            repo_name = (thread.get("repository") or {}).get("full_name") or "unknown"
            state = "未读" if thread.get("unread") else "已读"
            url = f"\n  {subject['html_url']}" if subject.get("html_url") else ""
            lines.append(
                f"- [{subject.get('type') or 'unknown'}] **{repo_name}** {subject.get('title')}"
                f"（{state}，{relative_time(thread.get('updated_at'))}）{url}"
            )
        return c.truncate(f"共 {len(result.items)} 条通知：\n" + "\n".join(lines))

    @tool(
        server,
        name="gitea_mark_notifications_read",
        title="标记通知已读",
        read_only=False,
        idempotent=True,
    )
    async def gitea_mark_notifications_read(
        # 参数名就叫 all：与 TS 版的 inputShape 逐字对齐，不能改成 includeAll 之类
        all: Annotated[bool | None, Field(description="是否标记全部通知，默认 true。")] = None,  # noqa: A002
        lastReadAt: Annotated[
            str | None,
            Field(description="仅标记该时间点之前的通知，ISO 8601 格式。设置后 `all` 失效。"),
        ] = None,
    ) -> str:
        """把全部通知（或某个时间点之前的通知）标记为已读。"""
        c = ctx()
        await AccountOperations(c.client).mark_notifications(
            # 给了 lastReadAt 就只标记那个时间点之前的（此时 all 必须让位）
            all_threads=False if lastReadAt else (all is not False),
            last_read_at=lastReadAt,
            to_status="read",
        )
        if lastReadAt:
            return f"已把 {lastReadAt} 之前的通知标记为已读。"
        return "已把全部通知标记为已读。"


__all__ = ["register"]
