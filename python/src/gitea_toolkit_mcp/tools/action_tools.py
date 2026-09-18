"""Gitea Actions 域工具（对应 TS 版 `src/ai/tools/actionTools.ts`）。

能力边界（与 Gitea 1.26.4 的 API 一致，不要凭空加）：

- **没有「取消运行」**：只有 ``rerun`` / ``rerun-failed-jobs``。
  ``DELETE /actions/runs/{run}`` 是删除记录，语义不同，这里刻意不暴露。
- 产物**只列不下载**：下载是 zip 二进制流，不适合作为工具返回值。

参数顺序：必填在前且不带默认值（详细理由见 `issue_tools.py` 顶部说明）。
"""

from __future__ import annotations

import json
from typing import Annotated, Any

from pydantic import Field

from ..operations import ActionOperations
from ._format import (
    action_state_label,
    format_artifact_line,
    format_job_line,
    format_run_line,
    format_workflow_line,
    relative_time,
)
#: 起别名是因为下面有个工具参数就叫 tail_lines（参数名即 schema 里的属性名，
#: 必须与 TS 版一致），不能与助手函数撞名
from ._format import tail_lines as _tail_lines
from ._registry import tool
from ._shared import OWNER_ARG, REPO_ARG, ctx, resolve_repo

_owner = OWNER_ARG
_repo = REPO_ARG


def register(server: Any) -> None:
    """注册 Actions 域全部工具。"""

    @tool(server, name="gitea_list_workflows", title="列出工作流")
    async def gitea_list_workflows(owner: _owner = None, repo: _repo = None) -> str:
        """列出仓库的全部工作流（即 .gitea/workflows 下的 YAML），包含启用状态与工作流 ID。"""
        c = ctx()
        target = resolve_repo(owner, repo)
        workflows = await ActionOperations(c.client).list_workflows(
            target.owner, target.repo
        )
        if not workflows:
            return (
                f"{target.full_name} 没有配置任何工作流"
                "（该接口只枚举 `.gitea/workflows/`，不包含 `.github/workflows/`）。"
            )
        lines = "\n".join(format_workflow_line(item) for item in workflows)
        return c.truncate(f"{target.full_name} 共 {len(workflows)} 个工作流：\n{lines}")

    @tool(server, name="gitea_list_action_runs", title="列出工作流运行记录")
    async def gitea_list_action_runs(
        owner: _owner = None,
        repo: _repo = None,
        event: Annotated[
            str | None,
            Field(
                description="触发事件过滤，例如 push / pull_request / workflow_dispatch / schedule。"
            ),
        ] = None,
        branch: Annotated[str | None, Field(description="按分支过滤。")] = None,
        status: Annotated[
            str | None,
            Field(description="按状态过滤，例如 success / failure / running / waiting。"),
        ] = None,
        actor: Annotated[str | None, Field(description="按触发者用户名过滤。")] = None,
        head_sha: Annotated[str | None, Field(description="按提交 SHA 过滤。")] = None,
        limit: Annotated[int | None, Field(ge=1, le=100, description="返回数量上限，默认 20。")] = None,
    ) -> str:
        """列出仓库的工作流运行记录，支持按触发事件、分支、状态、触发者、提交 SHA 过滤，用于排查 CI 是否通过。"""
        c = ctx()
        target = resolve_repo(owner, repo)
        result = await ActionOperations(c.client).list_runs(
            target.owner,
            target.repo,
            event=event,
            branch=branch,
            status=status,
            actor=actor,
            head_sha=head_sha,
            limit=limit or 20,
        )
        if not result.items:
            return "没有匹配的运行记录。"
        lines = "\n".join(format_run_line(item) for item in result.items)
        more = (
            "\n\n_还有更多记录，可调整过滤条件或增大 limit。_"
            if result.page_info.has_next_page
            else ""
        )
        return c.truncate(
            f"{target.full_name} 匹配到 {len(result.items)} 条运行记录：\n{lines}{more}"
        )

    @tool(server, name="gitea_get_action_run", title="获取工作流运行详情")
    async def gitea_get_action_run(
        run_id: Annotated[
            int,
            Field(ge=1, description="运行 ID（列表结果里的 run id，不是 # 后面的编号）。"),
        ],
        owner: _owner = None,
        repo: _repo = None,
    ) -> str:
        """获取单次工作流运行（workflow run）的详情，并列出它包含的全部作业及其步骤状态，用于定位是哪一步失败。"""
        c = ctx()
        target = resolve_repo(owner, repo)
        operations = ActionOperations(c.client)
        run = await operations.get_run(target.owner, target.repo, run_id)
        jobs = await operations.list_run_jobs(target.owner, target.repo, run_id)

        header = (
            f"**#{run.get('run_number') or run.get('id')}** {run.get('display_title') or ''}"
            f" —— {action_state_label(run.get('status'), run.get('conclusion'))}"
        )
        meta = " · ".join(
            part
            for part in (
                f"事件 `{run['event']}`" if run.get("event") else "",
                f"分支 `{run['head_branch']}`" if run.get("head_branch") else "",
                f"提交 `{str(run.get('head_sha') or '')[:7]}`" if run.get("head_sha") else "",
                f"触发者 @{(run.get('actor') or {}).get('login')}"
                if (run.get("actor") or {}).get("login")
                else "",
                f"开始于 {relative_time(run.get('started_at'))}",
            )
            if part
        )
        job_text = (
            "\n".join(format_job_line(job) for job in jobs) if jobs else "_（暂无作业）_"
        )
        failed = [job for job in jobs if job.get("conclusion") == "failure"]
        hint = (
            "\n\n> 失败作业："
            + "、".join(f"`{job.get('name')}`（job id `{job.get('id')}`）" for job in failed)
            + "，可用 `gitea_get_job_logs` 查看日志。"
            if failed
            else ""
        )
        return c.truncate(f"{header}\n\n{meta}\n\n作业：\n{job_text}{hint}")

    @tool(server, name="gitea_get_job_logs", title="获取作业日志")
    async def gitea_get_job_logs(
        job_id: Annotated[
            int, Field(ge=1, description="作业 ID（可从 gitea_get_action_run 的结果取得）。")
        ],
        owner: _owner = None,
        repo: _repo = None,
        tail_lines: Annotated[
            int | None, Field(ge=10, le=2000, description="保留末尾多少行，默认 200。")
        ] = None,
    ) -> str:
        """获取某个工作流作业的原始日志文本。默认只保留**末尾**若干行，因为失败信息通常出现在最后。"""
        c = ctx()
        target = resolve_repo(owner, repo)
        raw = await ActionOperations(c.client).get_job_logs(
            target.owner, target.repo, job_id
        )
        if not raw.strip():
            return f"作业 `{job_id}` 没有日志（可能仍在排队，或日志已被清理）。"
        text, truncated = _tail_lines(raw, tail_lines or 200)
        note = "\n\n_（日志较长，以上仅为末尾部分）_" if truncated else ""
        return c.truncate(f"作业 `{job_id}` 的日志：\n\n```\n{text}\n```{note}")

    @tool(server, name="gitea_list_artifacts", title="列出构建产物")
    async def gitea_list_artifacts(
        owner: _owner = None,
        repo: _repo = None,
        name: Annotated[str | None, Field(description="按产物名精确过滤。")] = None,
        limit: Annotated[int | None, Field(ge=1, le=100, description="返回数量上限，默认 20。")] = None,
    ) -> str:
        """列出仓库的工作流构建产物（artifact），包含大小与是否已过期。"""
        c = ctx()
        target = resolve_repo(owner, repo)
        result = await ActionOperations(c.client).list_artifacts(
            target.owner, target.repo, name=name, limit=limit or 20
        )
        if not result.items:
            return "没有匹配的构建产物。"
        lines = "\n".join(format_artifact_line(item) for item in result.items)
        return c.truncate(
            f"{target.full_name} 匹配到 {len(result.items)} 个产物：\n{lines}"
        )

    @tool(server, name="gitea_dispatch_workflow", title="触发工作流", read_only=False, destructive=False)
    async def gitea_dispatch_workflow(
        workflow_id: Annotated[
            str,
            Field(min_length=1, description="工作流 ID 或文件名，例如 `ci.yml`。可用 gitea_list_workflows 查询。"),
        ],
        ref: Annotated[str, Field(min_length=1, description="目标引用：分支名、标签名或提交 SHA。")],
        owner: _owner = None,
        repo: _repo = None,
        inputs: Annotated[
            dict[str, str] | None,
            Field(description="传给工作流的输入键值对（字符串），对应 workflow_dispatch 声明的 inputs。"),
        ] = None,
    ) -> str:
        """手动触发一个声明了 `on: workflow_dispatch` 的 Gitea 工作流，可指定分支/标签/提交与 inputs。若工作流未声明 workflow_dispatch，服务端会拒绝。"""
        c = ctx()
        target = resolve_repo(owner, repo)
        await ActionOperations(c.client).dispatch_workflow(
            target.owner,
            target.repo,
            workflow_id=workflow_id,
            ref=ref,
            inputs=inputs,
        )
        input_note = ""
        if inputs:
            input_note = (
                "\n\n传入的 inputs：\n```json\n"
                + json.dumps(inputs, ensure_ascii=False, indent=2)
                + "\n```"
            )
        return c.truncate(
            f"已触发工作流 `{workflow_id}`（ref `{ref}`）于 {target.full_name}。"
            f"运行需要一点时间才会出现在列表中。{input_note}"
        )

    @tool(server, name="gitea_rerun_action", title="重新运行工作流", read_only=False, destructive=False)
    async def gitea_rerun_action(
        run_id: Annotated[int, Field(ge=1, description="运行 ID。")],
        owner: _owner = None,
        repo: _repo = None,
        failed_only: Annotated[
            bool | None,
            Field(description="设为 true 时只重跑失败的作业，默认 false（整条重跑）。"),
        ] = None,
    ) -> str:
        """重新运行一次工作流运行记录：可整条重跑，也可只重跑失败的作业。注意 Gitea 的 API **不提供取消运行**，只有重跑。"""
        c = ctx()
        target = resolve_repo(owner, repo)
        failed_only_value = failed_only is True
        operations = ActionOperations(c.client)
        if failed_only_value:
            await operations.rerun_failed_jobs(target.owner, target.repo, run_id)
        else:
            await operations.rerun_run(target.owner, target.repo, run_id)
        return c.truncate(
            f"已提交重跑请求：{target.full_name} 运行 `{run_id}`"
            f"（{'仅失败的作业' if failed_only_value else '整条运行'}）。"
        )

    @tool(server, name="gitea_set_workflow_enabled", title="启用/停用工作流", read_only=False)
    async def gitea_set_workflow_enabled(
        workflow_id: Annotated[
            str, Field(min_length=1, description="工作流 ID 或文件名，例如 `ci.yml`。")
        ],
        enabled: Annotated[bool, Field(description="true 为启用，false 为停用。")],
        owner: _owner = None,
        repo: _repo = None,
    ) -> str:
        """启用或停用一个 Gitea 工作流。停用后该工作流不会响应任何触发事件。"""
        c = ctx()
        target = resolve_repo(owner, repo)
        await ActionOperations(c.client).set_workflow_enabled(
            target.owner, target.repo, workflow_id, enabled
        )
        return c.truncate(
            f"已{'启用' if enabled else '停用'}工作流 `{workflow_id}`（{target.full_name}）。"
        )


__all__ = ["register"]
