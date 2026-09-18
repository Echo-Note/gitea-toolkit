"""Pull Request 域工具（对应 TS 版 `src/ai/tools/pullTools.ts`）。

参数顺序：必填在前且不带默认值（详细理由见 `issue_tools.py` 顶部说明）。
"""

from __future__ import annotations

from typing import Annotated, Any, Literal
from collections.abc import Sequence

from pydantic import Field

from ..operations import PullOperations
from ._format import format_body, format_pull_line, relative_time, truncate
from ._registry import tool
from ._shared import OWNER_ARG, REPO_ARG, ctx, resolve_repo

_owner = OWNER_ARG
_repo = REPO_ARG


def register(server: Any) -> None:
    """注册 PR 域全部工具。"""

    @tool(server, name="gitea_list_pulls", title="列出 Pull Request")
    async def gitea_list_pulls(
        owner: _owner = None,
        repo: _repo = None,
        state: Annotated[
            Literal["open", "closed", "all"] | None, Field(description="状态筛选，默认 open。")
        ] = None,
        sort: Annotated[
            Literal[
                "oldest",
                "recentupdate",
                "leastupdate",
                "mostcomment",
                "leastcomment",
                "priority",
            ]
            | None,
            Field(description="排序方式，默认 oldest。"),
        ] = None,
        head: Annotated[str | None, Field(description="按源分支过滤。")] = None,
        base: Annotated[str | None, Field(description="按目标分支过滤。")] = None,
        limit: Annotated[int | None, Field(ge=1, le=100, description="返回数量上限，默认 30。")] = None,
    ) -> str:
        """列出仓库的 Pull Request，支持按状态、分支与排序过滤。"""
        c = ctx()
        target = resolve_repo(owner, repo)
        result = await PullOperations(c.client).list(
            target.owner,
            target.repo,
            state=state or "open",
            sort=sort,
            head=head,
            base=base,
            limit=limit or 30,
        )
        if not result.items:
            return "没有匹配的 Pull Request。"
        lines = "\n".join(format_pull_line(item) for item in result.items)
        return c.truncate(
            f"{target.full_name} 匹配到 {len(result.items)} 个 PR：\n{lines}"
        )

    @tool(server, name="gitea_get_pull", title="获取 PR 详情")
    async def gitea_get_pull(
        index: Annotated[int, Field(ge=1, description="PR 序号。")],
        owner: _owner = None,
        repo: _repo = None,
    ) -> str:
        """获取单个 Pull Request 的详情，包含可合并状态、变更规模、评审人等信息。"""
        c = ctx()
        target = resolve_repo(owner, repo)
        pull = await PullOperations(c.client).get(target.owner, target.repo, index)

        mergeable = pull.get("mergeable")
        mergeable_text = "未知" if mergeable is None else ("是" if mergeable else "否")
        flags = ""
        if pull.get("merged"):
            flags += "（已合并）"
        if pull.get("draft"):
            flags += "（草稿）"
        reviewers = ", ".join(
            f"@{user.get('login')}" for user in (pull.get("requested_reviewers") or [])
        )
        lines = [
            f"# #{pull.get('number')} {pull.get('title')}",
            "",
            f"- 状态：{pull.get('state')}{flags}",
            f"- 分支：`{(pull.get('head') or {}).get('ref') or '-'}` → "
            f"`{(pull.get('base') or {}).get('ref') or '-'}`",
            f"- 可合并：{mergeable_text}",
            f"- 变更：+{pull.get('additions') or 0} / -{pull.get('deletions') or 0}，"
            f"{pull.get('changed_files') or 0} 个文件",
            f"- 作者：@{((pull.get('user') or {}).get('login')) or 'unknown'}",
            f"- 评审人：{reviewers or '无'}",
            f"- 创建：{relative_time(pull.get('created_at'))}，"
            f"更新：{relative_time(pull.get('updated_at'))}",
            f"- 链接：{pull.get('html_url') or '-'}",
            "",
            "## 描述",
            "",
            format_body(pull.get("body")),
        ]
        return c.truncate("\n".join(lines))

    @tool(server, name="gitea_get_pull_diff", title="查看 PR 差异")
    async def gitea_get_pull_diff(
        index: Annotated[int, Field(ge=1, description="PR 序号。")],
        owner: _owner = None,
        repo: _repo = None,
        # 参数名就叫 format：与 TS 版对齐（改了就破坏两个实现的可互换性）
        format: Annotated[  # noqa: A002
            Literal["diff", "patch"] | None, Field(description="输出格式，默认 diff。")
        ] = None,
        maxLength: Annotated[
            int | None,
            Field(ge=2000, le=200_000, description="最大返回字符数，默认 40000。"),
        ] = None,
    ) -> str:
        """获取 Pull Request 的 unified diff 文本，用于代码评审。内容较长时会被截断，可配合 `gitea_list_pull_files` 先锁定关注文件。"""
        c = ctx()
        target = resolve_repo(owner, repo)
        diff = await PullOperations(c.client).get_diff(
            target.owner, target.repo, index, format=format or "diff"
        )
        limited = truncate(diff, maxLength or 40_000)
        return c.truncate(
            f"`{target.full_name}` PR #{index} 的差异（共 {len(diff)} 字符）：\n\n"
            f"```diff\n{limited}\n```"
        )

    @tool(server, name="gitea_list_pull_files", title="列出 PR 变更文件")
    async def gitea_list_pull_files(
        index: Annotated[int, Field(ge=1, description="PR 序号。")],
        owner: _owner = None,
        repo: _repo = None,
    ) -> str:
        """列出 Pull Request 涉及的文件及每个文件的新增 / 删除行数，便于快速定位评审重点。"""
        c = ctx()
        target = resolve_repo(owner, repo)
        files = await PullOperations(c.client).list_files(target.owner, target.repo, index)
        if not files:
            return "该 PR 没有文件变更。"
        lines = "\n".join(
            f"- `{file.get('filename')}`（{file.get('status') or 'modified'}，"
            f"+{file.get('additions') or 0} / -{file.get('deletions') or 0}）"
            for file in files
        )
        return c.truncate(f"PR #{index} 共 {len(files)} 个文件变更：\n{lines}")

    @tool(server, name="gitea_create_pull", title="创建 Pull Request", read_only=False, destructive=False)
    async def gitea_create_pull(
        title: Annotated[str, Field(min_length=1, description="PR 标题。")],
        head: Annotated[str, Field(min_length=1, description="源分支名，或 `owner:branch`。")],
        base: Annotated[str, Field(min_length=1, description="目标分支名。")],
        owner: _owner = None,
        repo: _repo = None,
        body: Annotated[str | None, Field(description="PR 描述，支持 Markdown。")] = None,
        reviewers: Annotated[
            Sequence[str] | None, Field(description="评审人用户名列表。")
        ] = None,
        assignees: Annotated[
            Sequence[str] | None, Field(description="指派人用户名列表。")
        ] = None,
    ) -> str:
        """创建 Pull Request。head 与 base 均为分支名，head 可写成 `owner:branch` 形式以支持跨仓库 PR。"""
        c = ctx()
        target = resolve_repo(owner, repo)
        pull = await PullOperations(c.client).create(
            target.owner,
            target.repo,
            title=title,
            head=head,
            base=base,
            body=body,
            reviewers=list(reviewers) if reviewers else None,
            assignees=list(assignees) if assignees else None,
        )
        return c.truncate(
            f"已创建 PR **#{pull.get('number')} {pull.get('title')}**\n"
            f"- 链接：{pull.get('html_url') or '-'}"
        )

    @tool(server, name="gitea_merge_pull", title="合并 Pull Request", read_only=False)
    async def gitea_merge_pull(
        index: Annotated[int, Field(ge=1, description="PR 序号。")],
        owner: _owner = None,
        repo: _repo = None,
        strategy: Annotated[
            Literal["merge", "rebase", "rebase-merge", "squash", "fast-forward-only"] | None,
            Field(description="合并策略，默认 merge。"),
        ] = None,
        deleteBranchAfterMerge: Annotated[
            bool | None, Field(description="合并后删除源分支。")
        ] = None,
        mergeTitle: Annotated[str | None, Field(description="自定义合并提交标题。")] = None,
        mergeMessage: Annotated[str | None, Field(description="自定义合并提交信息。")] = None,
    ) -> str:
        """合并 Pull Request，支持选择合并策略并可在合并后删除源分支。"""
        c = ctx()
        target = resolve_repo(owner, repo)
        result = await PullOperations(c.client).merge(
            target.owner,
            target.repo,
            index,
            strategy=strategy,
            delete_branch_after_merge=deleteBranchAfterMerge,
            merge_title=mergeTitle,
            merge_message=mergeMessage,
        )
        return c.truncate(f"{target.full_name} {result.get('message')}")

    @tool(server, name="gitea_review_pull", title="评审 Pull Request", read_only=False, destructive=False)
    async def gitea_review_pull(
        index: Annotated[int, Field(ge=1, description="PR 序号。")],
        event: Annotated[
            Literal["APPROVED", "REQUEST_CHANGES", "COMMENT"],
            Field(description="评审动作。"),
        ],
        owner: _owner = None,
        repo: _repo = None,
        body: Annotated[
            str | None,
            Field(description="评审说明，支持 Markdown。REQUEST_CHANGES 时建议必填。"),
        ] = None,
    ) -> str:
        """提交 PR 评审意见：批准（APPROVED）、请求修改（REQUEST_CHANGES）或仅评论（COMMENT）。"""
        c = ctx()
        target = resolve_repo(owner, repo)
        review = await PullOperations(c.client).create_review(
            target.owner, target.repo, index, event=event, body=body
        )
        action_text = {
            "APPROVED": "已批准",
            "REQUEST_CHANGES": "已请求修改",
            "COMMENT": "已提交评论",
        }.get(event, "已提交评审")
        return c.truncate(f"PR #{index} {action_text}（评审 #{review.get('id')}）")


__all__ = ["register"]
