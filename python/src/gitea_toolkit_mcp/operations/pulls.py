"""Pull Request 域操作（移植自 TS 版 `src/core/operations/pulls.ts`）。"""

from __future__ import annotations

from typing import Any, Literal
from urllib.parse import quote

from ..client import GiteaClient, ListResult

#: 排序方式；取值与 Gitea 的 ``sort`` 查询参数一致。
PullSort = Literal[
    "oldest",
    "recentupdate",
    "leastupdate",
    "mostcomment",
    "leastcomment",
    "priority",
]

#: 合并方式；与 Gitea 的 ``do`` 字段一致。
MergeStrategy = Literal[
    "merge",
    "rebase",
    "rebase-merge",
    "squash",
    "fast-forward-only",
    "manually-merged",
]

#: 评审动作。
ReviewEvent = Literal["APPROVED", "COMMENT", "REQUEST_CHANGES"]


def _enc(value: str) -> str:
    """URL 路径片段编码。"""
    return quote(str(value), safe="")


class PullOperations:
    """PR 的查询、创建、合并与评审。"""

    def __init__(self, client: GiteaClient) -> None:
        self._client = client

    async def list(
        self,
        owner: str,
        repo: str,
        *,
        state: str = "open",
        sort: PullSort | None = None,
        head: str | None = None,
        base: str | None = None,
        labels: str | None = None,
        milestone: int | None = None,
        page: int = 1,
        limit: int = 50,
    ) -> ListResult:
        """列出 PR。

        走 request_paged：服务端单页上限为 max_response_items（默认 50），
        想要更多必须真的翻页，只调大 limit 会被静默截断。
        """
        return await self._client.request_paged(
            "GET",
            f"/repos/{_enc(owner)}/{_enc(repo)}/pulls",
            limit=limit,
            start_page=page,
            query={
                "state": state,
                "sort": sort,
                "head": head,
                "base": base,
                "labels": labels,
                "milestone": milestone,
            },
            extract=lambda data: data if isinstance(data, list) else [],
        )

    async def get(self, owner: str, repo: str, index: int) -> dict[str, Any]:
        """取单个 PR 详情。"""
        return await self._client.request(
            "GET", f"/repos/{_enc(owner)}/{_enc(repo)}/pulls/{index}"
        )

    async def create(
        self,
        owner: str,
        repo: str,
        *,
        title: str,
        head: str,
        base: str,
        body: str | None = None,
        assignees: list[str] | None = None,
        reviewers: list[str] | None = None,
        team_reviewers: list[str] | None = None,
        labels: list[int] | None = None,
        milestone: int | None = None,
        allow_maintainer_edit: bool | None = None,
    ) -> dict[str, Any]:
        """创建 PR。

        ``head`` 允许写成 ``owner:branch``，用于从 fork 发起跨仓库 PR。
        """
        payload: dict[str, Any] = {"title": title, "head": head, "base": base}
        if body is not None:
            payload["body"] = body
        if assignees:
            payload["assignees"] = assignees
        if reviewers:
            payload["reviewers"] = reviewers
        if team_reviewers:
            payload["team_reviewers"] = team_reviewers
        if labels:
            payload["labels"] = labels
        if milestone is not None:
            payload["milestone"] = milestone
        if allow_maintainer_edit is not None:
            payload["allow_maintainer_edit"] = allow_maintainer_edit
        return await self._client.request(
            "POST", f"/repos/{_enc(owner)}/{_enc(repo)}/pulls", body=payload
        )

    async def get_diff(
        self,
        owner: str,
        repo: str,
        index: int,
        *,
        format: Literal["diff", "patch"] = "diff",  # noqa: A002 - 与工具层参数名保持一致
    ) -> str:
        """取 PR 的文本差异。

        ``.diff`` / ``.patch`` 返回的是**纯文本**，必须走 ``response_type="text"``
        ——响应不是 JSON，按 JSON 解析会直接失败。
        """
        raw = await self._client.request(
            "GET",
            f"/repos/{_enc(owner)}/{_enc(repo)}/pulls/{index}.{format}",
            response_type="text",
        )
        return raw if isinstance(raw, str) else ""

    async def list_files(self, owner: str, repo: str, index: int) -> list[Any]:
        """列出 PR 变更文件。

        用 ``request_paged``（上限放到 300）：单次请求在改动文件多的 PR 上
        会被服务端截断到 50 个且不报错，评审时会漏掉后面的文件。
        """
        result = await self._client.request_paged(
            "GET",
            f"/repos/{_enc(owner)}/{_enc(repo)}/pulls/{index}/files",
            limit=300,
            extract=lambda data: data if isinstance(data, list) else [],
        )
        return list(result.items)

    async def merge(
        self,
        owner: str,
        repo: str,
        index: int,
        *,
        strategy: MergeStrategy | None = None,
        delete_branch_after_merge: bool | None = None,
        force_merge: bool | None = None,
        merge_title: str | None = None,
        merge_message: str | None = None,
        merge_when_checks_succeed: bool | None = None,
        head_commit_id: str | None = None,
    ) -> dict[str, Any]:
        """合并 PR。

        服务端成功时可能返回**空响应体**，所以成功与否按「有没有抛异常」判定，
        返回文案由本地拼装（与 TS 版一致）。

        字段名按实例 swagger 的 ``MergePullRequestOption`` 核对：
        **全是小写蛇形**（``do`` / ``merge_title_field`` / ``merge_message_field``），
        写成 Go 结构体的 ``Do`` / ``MergeTitleField`` 会被服务端判为缺字段而报错。
        """
        strategy_value = strategy or "merge"
        payload: dict[str, Any] = {"do": strategy_value}
        if delete_branch_after_merge is not None:
            payload["delete_branch_after_merge"] = delete_branch_after_merge
        if force_merge is not None:
            payload["force_merge"] = force_merge
        if merge_title:
            payload["merge_title_field"] = merge_title
        if merge_message:
            payload["merge_message_field"] = merge_message
        if merge_when_checks_succeed is not None:
            payload["merge_when_checks_succeed"] = merge_when_checks_succeed
        if head_commit_id:
            payload["head_commit_id"] = head_commit_id
        await self._client.request(
            "POST",
            f"/repos/{_enc(owner)}/{_enc(repo)}/pulls/{index}/merge",
            body=payload,
        )
        return {"merged": True, "message": f"PR #{index} 已按 {strategy_value} 方式合并"}

    async def create_review(
        self,
        owner: str,
        repo: str,
        index: int,
        *,
        event: ReviewEvent,
        body: str | None = None,
        commit_id: str | None = None,
    ) -> dict[str, Any]:
        """提交 PR 评审（批准 / 请求修改 / 仅评论）。"""
        payload: dict[str, Any] = {"event": event}
        if body is not None:
            payload["body"] = body
        if commit_id:
            payload["commit_id"] = commit_id
        return await self._client.request(
            "POST",
            f"/repos/{_enc(owner)}/{_enc(repo)}/pulls/{index}/reviews",
            body=payload,
        )


__all__ = ["MergeStrategy", "PullOperations", "PullSort", "ReviewEvent"]
