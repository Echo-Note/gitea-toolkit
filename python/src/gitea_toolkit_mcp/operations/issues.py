"""Issue 域操作（移植自 TS 版 `src/core/operations/issues.ts`）。

Gitea 里 Issue 与 PR 共用底层表：``/repos/issues/search`` 用 ``type`` 参数区分两者，
本模块只处理 Issue（PR 见 ``pulls.py``）。
"""

from __future__ import annotations

from typing import Any, Literal
from urllib.parse import quote

from ..client import GiteaClient, ListResult

#: 状态取值；``all`` 表示不过滤。
#:
#: 用 ``Literal`` 而不是 ``str``：生成的 JSON Schema 里会带 enum，
#: 客户端据此渲染下拉框，也避免模型传入服务端不认的取值。
IssueState = Literal["open", "closed", "all"]

#: 条目类型（Issue 与 PR 共用接口时的区分参数）。
IssueSearchType = Literal["issues", "pulls"]


def _enc(value: str) -> str:
    """URL 路径片段编码。"""
    return quote(str(value), safe="")


def _flag(value: bool | None) -> str | None:
    """把布尔开关转成 Gitea 需要的查询值。

    必须显式写 ``"true"``：``urlencode`` 会把 Python 的 ``True`` 序列化成字面量
    ``True``，服务端不认，会当成「未提供」而静默忽略过滤条件。
    """
    return "true" if value else None


class IssueOperations:
    """Issue、评论与标签。"""

    def __init__(self, client: GiteaClient) -> None:
        self._client = client

    async def list(
        self,
        *,
        owner: str | None = None,
        repo: str | None = None,
        state: IssueState = "open",
        item_type: IssueSearchType = "issues",
        search: str | None = None,
        labels: str | None = None,
        milestones: str | None = None,
        assigned_to_me: bool | None = None,
        created_by_me: bool | None = None,
        mentioned_me: bool | None = None,
        review_requested_me: bool | None = None,
        reviewed_by_me: bool | None = None,
        sort: str | None = None,
        page: int = 1,
        limit: int = 50,
    ) -> ListResult:
        """列出 Issue。

        ``owner`` 与 ``repo`` 同时给出时走单仓库接口；否则走全局检索接口
        （「分配给我的 Issue」「提及我的 Issue」这类跨仓库场景只能用后者，
        过滤参数也只有后者支持）。
        """
        # 走 request_paged：服务端单页上限是 max_response_items（默认 50），
        # 想要更多必须真的翻页 —— 只调大 limit 会被**静默截断**。
        common: dict[str, Any] = {
            "state": state,
            "type": item_type,
            "q": search,
            "labels": labels,
            "milestones": milestones,
            "sort": sort,
        }
        extract = lambda data: data if isinstance(data, list) else []  # noqa: E731

        if owner and repo:
            return await self._client.request_paged(
                "GET",
                f"/repos/{_enc(owner)}/{_enc(repo)}/issues",
                limit=limit,
                start_page=page,
                query=common,
                extract=extract,
            )

        return await self._client.request_paged(
            "GET",
            "/repos/issues/search",
            limit=limit,
            start_page=page,
            query={
                **common,
                "assigned": _flag(assigned_to_me),
                "created": _flag(created_by_me),
                "mentioned": _flag(mentioned_me),
                "review_requested": _flag(review_requested_me),
                "reviewed": _flag(reviewed_by_me),
                "owner": owner,
            },
            extract=extract,
        )

    async def get(self, owner: str, repo: str, index: int) -> dict[str, Any]:
        """取单个 Issue 详情。"""
        return await self._client.request(
            "GET", f"/repos/{_enc(owner)}/{_enc(repo)}/issues/{index}"
        )

    async def create(
        self,
        owner: str,
        repo: str,
        *,
        title: str,
        body: str | None = None,
        assignees: list[str] | None = None,
        labels: list[int] | None = None,
        milestone: int | None = None,
        due_date: str | None = None,
        closed: bool | None = None,
        ref: str | None = None,
    ) -> dict[str, Any]:
        """创建 Issue。"""
        payload: dict[str, Any] = {"title": title}
        if body is not None:
            payload["body"] = body
        if assignees:
            payload["assignees"] = assignees
        if labels:
            payload["labels"] = labels
        if milestone is not None:
            payload["milestone"] = milestone
        if due_date:
            payload["due_date"] = due_date
        if closed is not None:
            payload["closed"] = closed
        if ref:
            payload["ref"] = ref
        return await self._client.request(
            "POST", f"/repos/{_enc(owner)}/{_enc(repo)}/issues", body=payload
        )

    async def update(
        self,
        owner: str,
        repo: str,
        index: int,
        *,
        title: str | None = None,
        body: str | None = None,
        state: Literal["open", "closed"] | None = None,
        assignees: list[str] | None = None,
        labels: list[int] | None = None,
        milestone: int | None = None,
        due_date: str | None = None,
        unset_due_date: bool = False,
    ) -> dict[str, Any]:
        """更新 Issue（只提交**显式给出**的字段）。

        ``labels`` 传空列表表示「清空标签」—— 所以调用方要用 ``None`` 区分「不改」与「清空」。
        """
        # ⚠️ 标签**不能**塞进 PATCH 的 body：实例 swagger 里 ``EditIssueOption`` 根本没有
        #    ``labels`` 字段（10 个字段里没有它），传了会被服务端**静默忽略** ——
        #    调用方以为改了标签、实际没改（TS 版就有这个问题）。
        #    标签有专门的替换端点，见下方。
        #    顺序刻意放在 PATCH **之前**：这样 PATCH 返回的实体里带的就是更新后的标签，
        #    不用再多发一次 GET 去取最新状态。
        if labels is not None:
            await self.replace_labels(owner, repo, index, labels)

        payload: dict[str, Any] = {}
        if title is not None:
            payload["title"] = title
        if body is not None:
            payload["body"] = body
        if state is not None:
            payload["state"] = state
        if assignees is not None:
            payload["assignees"] = assignees
        if milestone is not None:
            payload["milestone"] = milestone
        if due_date is not None:
            payload["due_date"] = due_date
        if unset_due_date:
            payload["unset_due_date"] = True
        return await self._client.request(
            "PATCH", f"/repos/{_enc(owner)}/{_enc(repo)}/issues/{index}", body=payload
        )

    async def replace_labels(
        self, owner: str, repo: str, index: int, labels: list[int]
    ) -> None:
        """整体替换 Issue 的标签（空列表 = 清空）。

        单独暴露成方法，是为了让「标签走专用端点」这件事在调用处看得见 ——
        它**不是** PATCH issue 的一部分（见 ``update`` 里的说明）。
        """
        await self._client.request(
            "PUT",
            f"/repos/{_enc(owner)}/{_enc(repo)}/issues/{index}/labels",
            body={"labels": labels},
        )

    async def list_comments(
        self, owner: str, repo: str, index: int, *, page: int = 1, limit: int = 50
    ) -> ListResult:
        """列出 Issue 的评论（翻页收集，见 ``request_paged`` 的说明）。"""
        return await self._client.request_paged(
            "GET",
            f"/repos/{_enc(owner)}/{_enc(repo)}/issues/{index}/comments",
            limit=limit,
            start_page=page,
            extract=lambda data: data if isinstance(data, list) else [],
        )

    async def create_comment(
        self, owner: str, repo: str, index: int, body: str
    ) -> dict[str, Any]:
        """在 Issue（或 PR 的对话区）发表评论。"""
        return await self._client.request(
            "POST",
            f"/repos/{_enc(owner)}/{_enc(repo)}/issues/{index}/comments",
            body={"body": body},
        )

    async def list_labels(self, owner: str, repo: str) -> list[Any]:
        """列出仓库标签（供创建 / 更新 Issue 时把标签名解析成 ID）。

        用 ``request_paged`` 而非单次 ``limit=200`` 请求：服务端单页上限默认 50，
        单次请求在标签多的仓库上会**静默少一半**，导致部分标签名解析不出 ID。
        """
        result = await self._client.request_paged(
            "GET",
            f"/repos/{_enc(owner)}/{_enc(repo)}/labels",
            limit=200,
            extract=lambda data: data if isinstance(data, list) else [],
        )
        return list(result.items)


__all__ = ["IssueOperations", "IssueSearchType", "IssueState"]
