"""账户与实例信息（对应 TS 版 `src/core/operations/misc.ts` 的 user / orgs / version）。"""

from __future__ import annotations

from typing import Any, Sequence

from ..client import GiteaClient


class AccountOperations:
    """当前用户、组织、实例版本。"""

    def __init__(self, client: GiteaClient) -> None:
        self._client = client

    async def current_user(self) -> dict[str, Any]:
        """当前令牌对应的用户 —— 也常用来校验令牌是否有效。"""
        return await self._client.request("GET", "/user")

    async def list_orgs(self, *, limit: int = 50) -> Sequence[Any]:
        """当前用户所属/可见的组织。"""
        result = await self._client.request_paged(
            "GET",
            "/user/orgs",
            limit=limit,
            extract=lambda data: data or [],
        )
        return result.items

    async def server_version(self) -> str:
        """实例版本号。"""
        raw = await self._client.request("GET", "/version", response_type="json")
        if isinstance(raw, dict):
            return str(raw.get("version") or "")
        return str(raw or "")


__all__ = ["AccountOperations"]
