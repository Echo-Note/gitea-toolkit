"""账户域工具：当前用户、组织（对应 TS 版 `src/ai/tools/accountTools.ts`）。"""

from __future__ import annotations

from typing import Any

from ..operations import AccountOperations
from ._registry import tool
from ._shared import ctx


def register(server: Any) -> None:
    """注册账户域工具。"""

    @tool(server, name="gitea_get_current_user")
    async def gitea_get_current_user() -> str:
        """获取当前访问令牌对应的 Gitea 用户信息。也可用于校验令牌是否有效、实例是否可连通。"""
        c = ctx()
        user = await AccountOperations(c.client).current_user()
        lines = [
            f"# {user.get('full_name') or user.get('login')}",
            "",
            f"- 用户名：`{user.get('login')}`",
            f"- 邮箱：{user.get('email') or '（未公开）'}",
            f"- 管理员：{'是' if user.get('is_admin') else '否'}",
            f"- 实例：{c.server_url}",
        ]
        return c.truncate("\n".join(lines))

    @tool(server, name="gitea_list_orgs")
    async def gitea_list_orgs() -> str:
        """列出当前用户所属或可见的 Gitea 组织。"""
        c = ctx()
        orgs = await AccountOperations(c.client).list_orgs()
        if not orgs:
            return "当前用户不属于任何组织。"
        lines = [f"- **{org.get('username') or org.get('name')}**" for org in orgs]
        return c.truncate(f"共 {len(orgs)} 个组织：\n" + "\n".join(lines))


__all__ = ["register"]
