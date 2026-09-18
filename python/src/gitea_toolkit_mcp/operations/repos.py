"""仓库域操作（移植自 TS 版 `src/core/operations/repos.ts`）。"""

from __future__ import annotations

import base64
from typing import Any, Sequence
from urllib.parse import quote

from ..client import GiteaClient, ListResult

#: 搜索接口返回的是 ``{"data": [...]}`` 而不是裸数组，需要解包
def _unwrap_search(data: Any) -> Sequence[Any]:
    if isinstance(data, dict):
        return data.get("data") or []
    return data or []


def _enc(value: str) -> str:
    """路径段转义（仓库名与分支名可能含 ``/``）。"""
    return quote(str(value), safe="")


class RepoOperations:
    """仓库、分支、提交、文件。"""

    def __init__(self, client: GiteaClient) -> None:
        self._client = client

    # ── 仓库 ────────────────────────────────────────────────────

    async def list(
        self,
        *,
        owner: str | None = None,
        search: str | None = None,
        mine: bool = False,
        limit: int = 30,
    ) -> ListResult:
        """列出仓库。

        三个来源互斥（与 TS 版一致的优先级）：关键词搜索 → 指定 owner → 当前用户。
        """
        if search:
            return await self._client.request_paged(
                "GET",
                "/repos/search",
                limit=limit,
                query={"q": search},
                extract=_unwrap_search,
            )
        if owner:
            # owner 可能是用户也可能是组织，两个端点都试（TS 版同样处理）
            try:
                return await self._client.request_paged(
                    "GET",
                    f"/orgs/{_enc(owner)}/repos",
                    limit=limit,
                    extract=lambda data: data or [],
                )
            except Exception:
                return await self._client.request_paged(
                    "GET",
                    f"/users/{_enc(owner)}/repos",
                    limit=limit,
                    extract=lambda data: data or [],
                )
        if mine:
            return await self._client.request_paged(
                "GET",
                "/user/repos",
                limit=limit,
                extract=lambda data: data or [],
            )
        return await self._client.request_paged(
            "GET",
            "/repos/search",
            limit=limit,
            extract=_unwrap_search,
        )

    async def get(self, owner: str, repo: str) -> dict[str, Any]:
        """取仓库详情。"""
        return await self._client.request("GET", f"/repos/{_enc(owner)}/{_enc(repo)}")

    async def create(
        self,
        *,
        name: str,
        owner: str | None = None,
        description: str | None = None,
        private: bool = False,
        auto_init: bool = True,
        default_branch: str | None = None,
    ) -> dict[str, Any]:
        """创建仓库。给了 owner 就建到组织名下，否则建到当前用户名下。"""
        path = f"/orgs/{_enc(owner)}/repos" if owner else "/user/repos"
        body: dict[str, Any] = {
            "name": name,
            "private": private,
            "auto_init": auto_init,
        }
        if description:
            body["description"] = description
        if default_branch:
            body["default_branch"] = default_branch
        return await self._client.request("POST", path, body=body)

    # ── 分支 ────────────────────────────────────────────────────

    async def list_branches(self, owner: str, repo: str, *, limit: int = 50) -> ListResult:
        """列出分支。"""
        return await self._client.request_paged(
            "GET",
            f"/repos/{_enc(owner)}/{_enc(repo)}/branches",
            limit=limit,
            extract=lambda data: data or [],
        )

    async def create_branch(
        self,
        owner: str,
        repo: str,
        *,
        new_branch: str,
        from_ref: str | None = None,
    ) -> dict[str, Any]:
        """基于已有分支/标签/提交创建分支。省略 from 时用仓库默认分支。"""
        target = from_ref or await self.default_branch(owner, repo)
        return await self._client.request(
            "POST",
            f"/repos/{_enc(owner)}/{_enc(repo)}/branches",
            body={"new_branch_name": new_branch, "old_branch_name": target},
        )

    async def default_branch(self, owner: str, repo: str) -> str:
        """取仓库默认分支名。"""
        detail = await self.get(owner, repo)
        return detail.get("default_branch") or "main"

    # ── 提交 ────────────────────────────────────────────────────

    async def list_commits(
        self,
        owner: str,
        repo: str,
        *,
        ref: str | None = None,
        path: str | None = None,
        limit: int = 20,
    ) -> ListResult:
        """列出提交历史。"""
        query: dict[str, Any] = {}
        if ref:
            query["sha"] = ref
        if path:
            query["path"] = path
        return await self._client.request_paged(
            "GET",
            f"/repos/{_enc(owner)}/{_enc(repo)}/commits",
            limit=limit,
            query=query,
            # Gitea 在仓库为空时会返回 409/空体，统一按空列表处理
            extract=lambda data: data if isinstance(data, list) else [],
        )

    async def commit_status(self, owner: str, repo: str, ref: str) -> dict[str, Any]:
        """查询某个 ref 的 CI 合并状态。"""
        return await self._client.request(
            "GET",
            f"/repos/{_enc(owner)}/{_enc(repo)}/commits/{_enc(ref)}/status",
        )

    # ── 文件 ────────────────────────────────────────────────────

    async def list_files(
        self,
        owner: str,
        repo: str,
        *,
        path: str | None = None,
        ref: str | None = None,
    ) -> Any:
        """列出目录内容（返回数组）；Gitea 在目标是文件时会回单对象。"""
        suffix = f"/{quote(path, safe='/')}" if path else ""
        query: dict[str, Any] = {}
        if ref:
            query["ref"] = ref
        return await self._client.request(
            "GET",
            f"/repos/{_enc(owner)}/{_enc(repo)}/contents{suffix}",
            query=query,
        )

    async def get_file(
        self,
        owner: str,
        repo: str,
        *,
        file_path: str,
        ref: str | None = None,
    ) -> dict[str, Any]:
        """读取文件内容（自动 base64 解码），并保留 blob SHA 供后续更新。"""
        query: dict[str, Any] = {}
        if ref:
            query["ref"] = ref
        raw = await self._client.request(
            "GET",
            f"/repos/{_enc(owner)}/{_enc(repo)}/contents/{quote(file_path, safe='/')}",
            query=query,
        )
        if isinstance(raw, list):
            raise ValueError(f"{file_path} 是一个目录，请改用 gitea_list_files")
        encoded = raw.get("content") or ""
        try:
            decoded = base64.b64decode(encoded, validate=False).decode("utf-8")
        except (ValueError, UnicodeDecodeError):
            decoded = ""
        return {**raw, "decoded_content": decoded}

    async def commit_file(
        self,
        owner: str,
        repo: str,
        *,
        file_path: str,
        content: str,
        message: str | None = None,
        branch: str | None = None,
        new_branch: str | None = None,
    ) -> dict[str, Any]:
        """创建或更新文件并提交；文件已存在时自动带上 blob SHA。"""
        target_branch = branch or new_branch or await self.default_branch(owner, repo)
        path = f"/repos/{_enc(owner)}/{_enc(repo)}/contents/{quote(file_path, safe='/')}"

        # 已存在则取 sha（更新必须带）
        sha: str | None = None
        try:
            existing = await self._client.request(
                "GET", path, query={"ref": target_branch}
            )
            if isinstance(existing, dict):
                sha = existing.get("sha")
        except Exception:
            sha = None

        body: dict[str, Any] = {
            "content": base64.b64encode(content.encode("utf-8")).decode("ascii"),
            "message": message or f"chore: {'更新' if sha else '新增'} {file_path}",
            "branch": target_branch,
        }
        if sha:
            body["sha"] = sha
        if new_branch:
            body["new_branch"] = new_branch
        return await self._client.request("PUT", path, body=body)


__all__ = ["RepoOperations"]
