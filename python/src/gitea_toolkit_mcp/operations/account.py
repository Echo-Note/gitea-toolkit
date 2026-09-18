"""账户与实例信息（对应 TS 版 `src/core/operations/misc.ts` 的 user / orgs / notifications / version）。"""

from __future__ import annotations

from typing import Any, Literal
from collections.abc import Sequence

from ..client import GiteaClient, ListResult

#: 通知的订阅主题类型。
NotificationSubjectType = Literal["issue", "pull", "commit", "repository"]

#: 通知状态类型。
NotificationStatusType = Literal["unread", "read", "pinned"]


class AccountOperations:
    """当前用户、组织、通知、实例版本。"""

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

    # ── 通知 ────────────────────────────────────────────────────

    async def list_notifications(
        self,
        *,
        include_read: bool | None = None,
        subject_types: Sequence[NotificationSubjectType] | None = None,
        page: int = 1,
        limit: int = 50,
    ) -> ListResult:
        """列出通知线程。

        两个参数都按实例 swagger 的 ``GET /notifications`` 核对：
        ``status-types`` 与 ``subject-type`` 是**数组**参数 —— Gitea 要求数组展开成
        同名重复参数（``api?status-types=unread&status-types=pinned``），
        客户端已按此规则拼装；逗号拼接服务端不认。

        默认只看 ``unread`` + ``pinned``：Gitea 网页端「未读」就是这个口径，
        已读通知通常只带来噪音。
        """
        # 走 request_paged：服务端单页上限为 max_response_items（默认 50）。
        return await self._client.request_paged(
            "GET",
            "/notifications",
            limit=limit,
            start_page=page,
            query={
                "all": "true" if include_read else None,
                "status-types": (
                    ["unread", "read", "pinned"] if include_read else ["unread", "pinned"]
                ),
                "subject-type": list(subject_types) if subject_types else None,
            },
            extract=lambda data: data if isinstance(data, list) else [],
        )

    async def mark_thread_read(self, thread_id: int) -> None:
        """把单条通知线程标记为已读。"""
        await self._client.request(
            "PATCH", f"/notifications/threads/{thread_id}", body={"to_status": "read"}
        )

    async def mark_notifications(
        self,
        *,
        all_threads: bool = False,
        last_read_at: str | None = None,
        to_status: NotificationStatusType = "read",
        status_types: Sequence[NotificationStatusType] | None = None,
    ) -> None:
        """批量标记通知状态。

        该接口**用查询参数传参**（不是 body）—— 与常见写法相反，别照直觉写。
        """
        await self._client.request(
            "PUT",
            "/notifications",
            query={
                "all": "true" if all_threads else None,
                "last_read_at": last_read_at,
                "to-status": to_status,
                "status-types": list(status_types) if status_types else ["unread", "pinned"],
            },
        )


__all__ = [
    "AccountOperations",
    "NotificationStatusType",
    "NotificationSubjectType",
]
