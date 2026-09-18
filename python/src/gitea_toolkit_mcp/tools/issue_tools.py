"""Issue 域工具（对应 TS 版 `src/ai/tools/issueTools.ts`）。

参数顺序的约定（本包所有工具一致）：**必填参数排在前面且不带默认值** ——
MCP 的 ``inputSchema.required`` 是从函数签名推导的，写成 ``index: int = 0`` 会让 schema
宣称「index 可选」，模型因此只能靠猜，缺参时还要多跑一轮才能拿到报错。
"""

from __future__ import annotations

from typing import Annotated, Any, Literal
from collections.abc import Sequence

from pydantic import Field

from ..operations import IssueOperations
from ..repo_ref import RepoRef
from ._format import format_body, format_comment, format_issue_line, relative_time
from ._registry import tool
from ._shared import OWNER_ARG, REPO_ARG, ctx, resolve_repo

_owner = OWNER_ARG
_repo = REPO_ARG


def _maybe_repo(owner: str | None, repo: str | None) -> RepoRef | None:
    """尽量解析出单仓库坐标；解析不出时返回 ``None``，表示「跨仓库检索」。

    与 TS 版同义，但把两种边界写明确：
      - **只给 owner**：按「该 owner 下的全部仓库」检索（TS 版同样忽略 repo）；
      - **只给 repo 却推不出 owner**：直接报错，而不是**静默丢掉 repo、
        返回一堆无关仓库的 Issue** —— 那种「看起来成功、结果全不对」最难排查。
    """
    if owner and repo:
        return RepoRef(owner=owner, repo=repo)
    if owner and not repo:
        return None
    try:
        return resolve_repo(None, repo)
    except ValueError:
        if repo:
            raise ValueError(
                f"提供了 repo（{repo}）但无法确定 owner：请同时传入 owner，"
                "或在某个 Gitea 仓库目录下启动本服务"
            ) from None
        return None


async def _resolve_label_ids(
    owner: str, repo: str, names: Sequence[str] | None
) -> tuple[list[int], list[str]]:
    """把标签**名称**解析成 Gitea 需要的标签 **ID**。

    未匹配到的名称**不报错**，而是与命中的 ID 一起返回，由调用方在结果里说明 ——
    否则用户写错一个标签名，整个创建 / 更新就白跑了。
    """
    if not names:
        return [], []
    try:
        labels = await IssueOperations(ctx().client).list_labels(owner, repo)
    except Exception:
        # 取标签失败不应让「创建 Issue」本身失败：退回「全部未识别」，
        # 与 TS 版行为一致（宁可少打标签，也不要把主流程搞挂）。
        return [], list(names)

    by_name = {
        str(label.get("name", "")).lower(): label.get("id")
        for label in labels
        if isinstance(label, dict)
    }
    ids: list[int] = []
    missing: list[str] = []
    for name in names:
        found = by_name.get(name.lower())
        if found is None:
            missing.append(name)
        else:
            ids.append(int(found))
    return ids, missing


def _missing_note(missing: Sequence[str]) -> str:
    """未识别标签的提示行（与 TS 版同文案）。"""
    return f"\n> 未识别到标签：{', '.join(missing)}（已忽略）" if missing else ""


def register(server: Any) -> None:
    """注册 Issue 域全部工具。"""

    @tool(server, name="gitea_list_issues", title="列出 Issue")
    async def gitea_list_issues(
        owner: _owner = None,
        repo: _repo = None,
        state: Annotated[
            Literal["open", "closed", "all"] | None, Field(description="状态筛选，默认 open。")
        ] = None,
        search: Annotated[str | None, Field(description="关键词，匹配标题与正文。")] = None,
        labels: Annotated[str | None, Field(description="标签名，多个用英文逗号分隔。")] = None,
        assignedToMe: Annotated[bool | None, Field(description="只看分配给我的 Issue。")] = None,
        createdByMe: Annotated[bool | None, Field(description="只看我创建的 Issue。")] = None,
        mentionedMe: Annotated[bool | None, Field(description="只看提及我的 Issue。")] = None,
        limit: Annotated[int | None, Field(ge=1, le=100, description="返回数量上限，默认 30。")] = None,
    ) -> str:
        """列出 Issue。可限定到具体仓库，也可跨仓库检索（用于「分配给我的 Issue」「我创建的 Issue」「提及我的 Issue」等场景）。"""
        c = ctx()
        ref = _maybe_repo(owner, repo)
        result = await IssueOperations(c.client).list(
            owner=ref.owner if ref else owner,
            repo=ref.repo if ref else None,
            state=state or "open",
            search=search,
            labels=labels,
            assigned_to_me=assignedToMe,
            created_by_me=createdByMe,
            mentioned_me=mentionedMe,
            limit=limit or 30,
        )
        if not result.items:
            return "没有匹配的 Issue。"
        scope = ref.full_name if ref else "全部可见仓库"
        lines = "\n".join(format_issue_line(item) for item in result.items)
        return c.truncate(f"{scope} 匹配到 {len(result.items)} 个 Issue：\n{lines}")

    @tool(server, name="gitea_get_issue", title="获取 Issue 详情")
    async def gitea_get_issue(
        index: Annotated[int, Field(ge=1, description="Issue 序号（URL 中 # 后面的数字）。")],
        owner: _owner = None,
        repo: _repo = None,
    ) -> str:
        """获取单个 Issue 的完整信息，包含正文、标签、指派人与链接。"""
        c = ctx()
        target = resolve_repo(owner, repo)
        issue = await IssueOperations(c.client).get(target.owner, target.repo, index)
        assignees = ", ".join(
            f"@{user.get('login')}" for user in (issue.get("assignees") or [])
        )
        label_names = ", ".join(
            str(label.get("name")) for label in (issue.get("labels") or [])
        )
        lines = [
            f"# #{issue.get('number')} {issue.get('title')}",
            "",
            f"- 状态：{issue.get('state')}",
            f"- 作者：@{((issue.get('user') or {}).get('login')) or 'unknown'}",
            f"- 指派：{assignees or '无'}",
            f"- 标签：{label_names or '无'}",
            f"- 创建：{relative_time(issue.get('created_at'))}，"
            f"更新：{relative_time(issue.get('updated_at'))}",
            f"- 评论数：{issue.get('comments') or 0}",
            f"- 链接：{issue.get('html_url') or '-'}",
            "",
            "## 正文",
            "",
            format_body(issue.get("body")),
        ]
        return c.truncate("\n".join(lines))

    @tool(server, name="gitea_create_issue", title="创建 Issue", read_only=False, destructive=False)
    async def gitea_create_issue(
        title: Annotated[str, Field(min_length=1, description="Issue 标题。")],
        owner: _owner = None,
        repo: _repo = None,
        body: Annotated[str | None, Field(description="Issue 正文，支持 Markdown。")] = None,
        assignees: Annotated[
            Sequence[str] | None, Field(description="指派人的用户名列表。")
        ] = None,
        labels: Annotated[Sequence[str] | None, Field(description="标签名称列表。")] = None,
    ) -> str:
        """在仓库中创建 Issue。`labels` 传标签名称（区分大小写不敏感），会自动解析为标签 ID；无法识别的标签会被忽略并在返回结果中说明。"""
        c = ctx()
        target = resolve_repo(owner, repo)
        ids, missing = await _resolve_label_ids(target.owner, target.repo, labels)
        issue = await IssueOperations(c.client).create(
            target.owner,
            target.repo,
            title=title,
            body=body,
            assignees=list(assignees) if assignees else None,
            labels=ids or None,
        )
        return c.truncate(
            f"已创建 Issue **#{issue.get('number')} {issue.get('title')}**\n"
            f"- 链接：{issue.get('html_url') or '-'}{_missing_note(missing)}"
        )

    @tool(server, name="gitea_update_issue", title="更新 Issue", read_only=False)
    async def gitea_update_issue(
        index: Annotated[int, Field(ge=1, description="Issue 序号。")],
        owner: _owner = None,
        repo: _repo = None,
        title: Annotated[str | None, Field(description="新标题。")] = None,
        body: Annotated[str | None, Field(description="新正文。")] = None,
        state: Annotated[
            Literal["open", "closed"] | None, Field(description="目标状态。")
        ] = None,
        assignees: Annotated[
            Sequence[str] | None, Field(description="新的指派人用户名列表（整体替换）。")
        ] = None,
        labels: Annotated[
            Sequence[str] | None, Field(description="新的标签名称列表（整体替换）。")
        ] = None,
    ) -> str:
        """更新 Issue 的标题、正文、状态（关闭 / 重新打开）、指派人与标签。"""
        c = ctx()
        target = resolve_repo(owner, repo)
        ids, missing = await _resolve_label_ids(target.owner, target.repo, labels)
        issue = await IssueOperations(c.client).update(
            target.owner,
            target.repo,
            index,
            title=title,
            body=body,
            state=state,
            assignees=list(assignees) if assignees is not None else None,
            # 传了 labels（哪怕是空列表）就整体替换；没传则不动 —— 用 None 区分「不改」与「清空」
            labels=ids if labels is not None else None,
        )
        return c.truncate(
            f"已更新 Issue **#{issue.get('number')}**，当前状态 {issue.get('state')}"
            f"{_missing_note(missing)}"
        )

    @tool(server, name="gitea_comment_issue", title="评论 Issue", read_only=False, destructive=False)
    async def gitea_comment_issue(
        index: Annotated[int, Field(ge=1, description="Issue 序号。")],
        body: Annotated[str, Field(min_length=1, description="评论正文，支持 Markdown。")],
        owner: _owner = None,
        repo: _repo = None,
    ) -> str:
        """在 Issue（或 PR 的对话区）中发表评论。"""
        c = ctx()
        target = resolve_repo(owner, repo)
        comment = await IssueOperations(c.client).create_comment(
            target.owner, target.repo, index, body
        )
        return c.truncate(
            f"已发表评论（#{comment.get('id')}）：{comment.get('html_url') or ''}"
        )

    @tool(server, name="gitea_list_issue_comments", title="列出 Issue 评论")
    async def gitea_list_issue_comments(
        index: Annotated[int, Field(ge=1, description="Issue 序号。")],
        owner: _owner = None,
        repo: _repo = None,
        limit: Annotated[int | None, Field(ge=1, le=200, description="返回数量上限，默认 50。")] = None,
    ) -> str:
        """列出 Issue 的时间线评论，用于了解讨论上下文。"""
        c = ctx()
        target = resolve_repo(owner, repo)
        result = await IssueOperations(c.client).list_comments(
            target.owner, target.repo, index, limit=limit or 50
        )
        if not result.items:
            return "该 Issue 暂无评论。"
        blocks = [
            format_comment(comment, position)
            for position, comment in enumerate(result.items, start=1)
        ]
        return c.truncate(
            f"共 {len(result.items)} 条评论：\n\n" + "\n\n---\n\n".join(blocks)
        )


__all__ = ["register"]
