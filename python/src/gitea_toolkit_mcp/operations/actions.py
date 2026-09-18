"""Gitea Actions 操作（移植自 TS 版 `src/core/operations/actions.ts`）。

路径与字段依据实例的 ``/swagger.v1.json`` 逐一核对（Gitea 1.26.4）。两处能力边界值得记住：

- **没有「取消运行」接口**。只有 ``rerun`` / ``rerun-failed-jobs``；
  ``DELETE /actions/runs/{run}`` 是**删除记录**，语义完全不同，不要包装成「取消」。
- 作业**日志**是**纯文本**（``/actions/jobs/{job_id}/logs``），必须走 ``response_type="text"``，
  否则 JSON 解析会直接失败。
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from ..client import GiteaClient, ListResult
from ..errors import GiteaApiError


def _enc(value: str) -> str:
    """URL 路径片段编码。"""
    return quote(str(value), safe="")


def _path(owner: str, repo: str, suffix: str) -> str:
    """拼接仓库级 Actions 路径；``suffix`` 需自带前导斜杠。"""
    return f"/repos/{_enc(owner)}/{_enc(repo)}/actions{suffix}"


class ActionOperations:
    """工作流、运行记录、作业、日志与产物。"""

    def __init__(self, client: GiteaClient) -> None:
        self._client = client

    async def list_workflows(self, owner: str, repo: str) -> list[Any]:
        """列出仓库的工作流。

        ⚠️ 该接口**只枚举 ``.gitea/workflows``**，忽略 ``.github/workflows``
        （镜像 GitHub Actions 的仓库因此会返回空列表）。这是服务端行为，
        与 TS 版保持一致，不做本地回落 —— 两个实现的返回文本要能互换。
        """
        raw = await self._client.request("GET", _path(owner, repo, "/workflows"))
        if isinstance(raw, dict):
            return list(raw.get("workflows") or [])
        return []

    async def set_workflow_enabled(
        self, owner: str, repo: str, workflow_id: str, enabled: bool
    ) -> None:
        """启用或停用工作流。"""
        action = "enable" if enabled else "disable"
        await self._client.request(
            "PUT", _path(owner, repo, f"/workflows/{_enc(workflow_id)}/{action}")
        )

    async def dispatch_workflow(
        self,
        owner: str,
        repo: str,
        *,
        workflow_id: str,
        ref: str,
        inputs: dict[str, str] | None = None,
    ) -> None:
        """触发一次 ``workflow_dispatch``。

        只有声明了 ``on: workflow_dispatch`` 的工作流才能被触发，否则服务端报错。
        """
        payload: dict[str, Any] = {"ref": ref}
        if inputs:
            payload["inputs"] = inputs
        await self._client.request(
            "POST", _path(owner, repo, f"/workflows/{_enc(workflow_id)}/dispatches"), body=payload
        )

    async def list_runs(
        self,
        owner: str,
        repo: str,
        *,
        event: str | None = None,
        branch: str | None = None,
        status: str | None = None,
        actor: str | None = None,
        head_sha: str | None = None,
        page: int = 1,
        limit: int = 30,
    ) -> ListResult:
        """列出运行记录（翻页收集）。

        响应是 ``{workflow_runs: [...], total_count}`` 的包装，不是裸数组。
        """
        return await self._client.request_paged(
            "GET",
            _path(owner, repo, "/runs"),
            limit=limit,
            start_page=page,
            query={
                "event": event,
                "branch": branch,
                "status": status,
                "actor": actor,
                "head_sha": head_sha,
            },
            extract=lambda data: list((data or {}).get("workflow_runs") or [])
            if isinstance(data, dict)
            else [],
        )

    async def get_run(self, owner: str, repo: str, run: int) -> dict[str, Any]:
        """读取单条运行记录。"""
        return await self._client.request("GET", _path(owner, repo, f"/runs/{run}"))

    async def rerun_run(self, owner: str, repo: str, run: int) -> None:
        """整条重跑。"""
        await self._client.request("POST", _path(owner, repo, f"/runs/{run}/rerun"))

    async def rerun_failed_jobs(self, owner: str, repo: str, run: int) -> None:
        """只重跑失败的作业。"""
        await self._client.request(
            "POST", _path(owner, repo, f"/runs/{run}/rerun-failed-jobs")
        )

    async def list_run_jobs(self, owner: str, repo: str, run: int) -> list[Any]:
        """列出某次运行下的全部作业（响应是 ``{jobs: [...]}`` 包装）。"""
        raw = await self._client.request("GET", _path(owner, repo, f"/runs/{run}/jobs"))
        if isinstance(raw, dict):
            return list(raw.get("jobs") or [])
        return []

    async def get_job_logs(self, owner: str, repo: str, job_id: int) -> str:
        """读取作业日志（纯文本）。

        **404 按「没有日志」处理，不抛错**：作业被取消、还没开始执行，或日志已被
        Gitea 的保留期清理时，服务端都没有日志文件，该接口返回 404
        （swagger 里本来就声明了 400/404）。这不是异常，更不是「无权访问」。
        """
        try:
            raw = await self._client.request(
                "GET", _path(owner, repo, f"/jobs/{job_id}/logs"), response_type="text"
            )
        except GiteaApiError as error:
            if error.status == 404:
                return ""
            raise
        return raw if isinstance(raw, str) else ""

    async def list_artifacts(
        self,
        owner: str,
        repo: str,
        *,
        name: str | None = None,
        page: int = 1,
        limit: int = 30,
    ) -> ListResult:
        """列出构建产物（响应是 ``{artifacts: [...]}`` 包装）。"""
        return await self._client.request_paged(
            "GET",
            _path(owner, repo, "/artifacts"),
            limit=limit,
            start_page=page,
            query={"name": name},
            extract=lambda data: list((data or {}).get("artifacts") or [])
            if isinstance(data, dict)
            else [],
        )


__all__ = ["ActionOperations"]
