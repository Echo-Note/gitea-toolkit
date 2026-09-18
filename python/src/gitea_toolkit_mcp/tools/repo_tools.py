"""仓库域工具：列表 / 详情 / 创建 / 分支 / 提交 / 文件（对应 TS 版 `src/ai/tools/repoTools.ts`）。"""

from __future__ import annotations

from typing import Annotated, Any
from collections.abc import Sequence

from pydantic import Field

from ..operations import RepoOperations
from ._registry import tool
from ._shared import OWNER_ARG as _owner, REPO_ARG as _repo, ctx, relative_time, resolve_repo


def _resolve(owner: str | None, repo: str | None):
    """解析仓库坐标（显式参数优先，其次从工作目录的 git origin 推断）。"""
    return resolve_repo(owner, repo)


def _repo_line(item: dict[str, Any]) -> str:
    """仓库单行展示：全名 + 默认分支 + 未关闭 Issue/PR + 最近更新。"""
    full_name = item.get("full_name") or f"{item.get('owner', {}).get('login', '?')}/{item.get('name', '?')}"
    bits = [f"**{full_name}**"]
    if item.get("archived"):
        bits.append("已归档")
    if item.get("default_branch"):
        bits.append(f"默认分支 `{item['default_branch']}`")
    if item.get("open_issues_count"):
        bits.append(f"未关闭 {item['open_issues_count']}")
    if item.get("description"):
        bits.append(str(item["description"]))
    updated = relative_time(item.get("updated_at"))
    if updated:
        bits.append(f"更新于 {updated}")
    return "- " + " · ".join(bits)


def register(server: Any) -> None:
    """注册仓库域全部工具。"""

    @tool(server, name="gitea_list_repos", title="列出仓库")
    async def gitea_list_repos(
        owner: Annotated[str | None, Field(description="只看某个组织或用户的仓库。")] = None,
        search: Annotated[str | None, Field(description="关键词搜索；提供后会走全文搜索接口。")] = None,
        mine: Annotated[bool | None, Field(description="设为 true 时只列出当前令牌所属用户拥有的仓库。")] = None,
        limit: Annotated[int | None, Field(ge=1, le=100, description="返回数量上限，默认 30。")] = None,
    ) -> str:
        """列出当前令牌可见的 Gitea 仓库，支持按组织过滤或关键词搜索。返回仓库全名、默认分支、未关闭 Issue / PR 数量与最后更新时间。"""
        c = ctx()
        result = await RepoOperations(c.client).list(
            owner=owner, search=search, mine=bool(mine), limit=limit or 30
        )
        if not result.items:
            return "没有找到匹配的仓库。"
        more = "（还有更多，可调大 limit）" if result.page_info.has_next_page else ""
        header = f"共 {len(result.items)} 个仓库{more}：\n"
        return c.truncate(header + "\n".join(_repo_line(item) for item in result.items))

    @tool(server, name="gitea_get_repo", title="获取仓库详情")
    async def gitea_get_repo(owner: _owner = None, repo: _repo = None) -> str:
        """获取指定 Gitea 仓库的详细信息，包括默认分支、权限、是否为空仓库、克隆地址等。"""
        c = ctx()
        ref = _resolve(owner, repo)
        detail = await RepoOperations(c.client).get(ref.owner, ref.repo)
        permissions = detail.get("permissions") or {}
        lines = [
            f"# {detail.get('full_name') or ref.full_name}",
            "",
            f"- 默认分支：`{detail.get('default_branch') or '（未知）'}`",
            f"- 私有：{'是' if detail.get('private') else '否'}"
            f"｜空仓库：{'是' if detail.get('empty') else '否'}"
            f"｜已归档：{'是' if detail.get('archived') else '否'}",
            f"- 未关闭 Issue/PR：{detail.get('open_issues_count', 0)}",
            # 权限：原先是 `f"- 权限：" + join(...) or "- 权限：（未知）"` ——
            # `+` 优先级高于 `or`，而左边永远是非空字符串（至少含「- 权限：」），
            # 所以 `or` 那半边是**死代码**，无权限时只会显示一个空荡荡的「- 权限：」。
            "- 权限：" + ("、".join(k for k, v in permissions.items() if v) or "（未知）"),
        ]
        if detail.get("description"):
            lines.append(f"- 描述：{detail['description']}")
        if detail.get("clone_url"):
            lines.append(f"- 克隆地址：{detail['clone_url']}")
        updated = relative_time(detail.get("updated_at"))
        if updated:
            lines.append(f"- 最近更新：{updated}")
        return c.truncate("\n".join(lines))

    @tool(server, name="gitea_create_repo", title="创建仓库", read_only=False, destructive=False)
    async def gitea_create_repo(
        name: Annotated[str, Field(description="仓库名。")],
        owner: Annotated[str | None, Field(description="组织名；省略则创建到当前用户名下。")] = None,
        description: Annotated[str | None, Field(description="仓库描述。")] = None,
        private: Annotated[bool | None, Field(description="是否设为私有，默认 false。")] = None,
        autoInit: Annotated[bool | None, Field(description="是否自动初始化（生成 README），默认 true。")] = None,
        defaultBranch: Annotated[str | None, Field(description="默认分支名，例如 main。")] = None,
    ) -> str:
        """在 Gitea 上创建新仓库。可通过 `owner` 指定组织；不指定时创建到当前令牌所属用户名下。默认会自动初始化 README。"""
        c = ctx()
        created = await RepoOperations(c.client).create(
            name=name,
            owner=owner,
            description=description,
            private=bool(private),
            auto_init=True if autoInit is None else bool(autoInit),
            default_branch=defaultBranch,
        )
        where = "组织" if owner else "个人"
        return (
            f"已在{where}下创建仓库 **{created.get('full_name') or name}**\n"
            f"- 默认分支：`{created.get('default_branch') or '（未知）'}`\n"
            f"- 克隆地址：{created.get('clone_url') or '（未知）'}"
        )

    @tool(server, name="gitea_list_branches", title="列出分支")
    async def gitea_list_branches(
        owner: _owner = None,
        repo: _repo = None,
        limit: Annotated[int | None, Field(ge=1, le=200, description="返回数量上限，默认 50。")] = None,
    ) -> str:
        """列出仓库的所有分支及其最新提交 SHA。"""
        c = ctx()
        ref = _resolve(owner, repo)
        result = await RepoOperations(c.client).list_branches(ref.owner, ref.repo, limit=limit or 50)
        if not result.items:
            return f"{ref.full_name} 还没有任何分支（空仓库？）。"
        lines = [
            f"- `{item.get('name')}` → `{(item.get('commit') or {}).get('id', '')[:10]}`"
            for item in result.items
        ]
        more = "（还有更多，可调大 limit）" if result.page_info.has_next_page else ""
        return c.truncate(f"共 {len(result.items)} 个分支{more}：\n" + "\n".join(lines))

    @tool(server, name="gitea_create_branch", title="创建分支", read_only=False, destructive=False)
    async def gitea_create_branch(
        newBranch: Annotated[str, Field(min_length=1, description="新分支名。")],
        owner: _owner = None,
        repo: _repo = None,
        from_: Annotated[
            str | None, Field(alias="from", description="源分支 / 标签 / 提交 SHA；省略时基于仓库默认分支。")
        ] = None,
    ) -> str:
        """基于已有分支 / 标签 / 提交创建新分支。"""
        c = ctx()
        ref = _resolve(owner, repo)
        created = await RepoOperations(c.client).create_branch(
            ref.owner, ref.repo, new_branch=newBranch, from_ref=from_
        )
        return (
            f"已创建分支 `{newBranch}`（基于 `{from_ or '默认分支'}`）\n"
            f"- 指向提交：`{(created.get('commit') or {}).get('id', '')[:10]}`"
        )

    @tool(server, name="gitea_list_commits", title="列出提交")
    async def gitea_list_commits(
        owner: _owner = None,
        repo: _repo = None,
        ref: Annotated[str | None, Field(description="分支名 / 标签 / 提交 SHA；省略时使用默认分支。")] = None,
        path: Annotated[str | None, Field(description="仅列出影响该文件或目录的提交。")] = None,
        limit: Annotated[int | None, Field(ge=1, le=100, description="返回数量上限，默认 20。")] = None,
    ) -> str:
        """列出仓库某个分支 / 路径上的提交历史。"""
        c = ctx()
        target = _resolve(owner, repo)
        result = await RepoOperations(c.client).list_commits(
            target.owner, target.repo, ref=ref, path=path, limit=limit or 20
        )
        if not result.items:
            return "没有找到提交。"
        lines: list[str] = []
        for item in result.items:
            summary = (item.get("commit") or {}).get("message", "").strip().split("\n")[0]
            author = ((item.get("commit") or {}).get("author") or {}).get("name") or (
                item.get("author") or {}
            ).get("login", "")
            when = relative_time(((item.get("commit") or {}).get("author") or {}).get("date"))
            lines.append(f"- `{item.get('sha', '')[:10]}` {summary} —— {author} {when}".rstrip())
        more = "（还有更多，可调大 limit）" if result.page_info.has_next_page else ""
        return c.truncate(f"共 {len(result.items)} 条提交{more}：\n" + "\n".join(lines))

    @tool(server, name="gitea_list_files", title="列出目录")
    async def gitea_list_files(
        owner: _owner = None,
        repo: _repo = None,
        path: Annotated[str | None, Field(description="目录路径，省略表示仓库根目录。")] = None,
        ref: Annotated[str | None, Field(description="分支名 / 标签 / 提交 SHA。")] = None,
    ) -> str:
        """列出仓库中某个目录下的文件与子目录。"""
        c = ctx()
        target = _resolve(owner, repo)
        raw = await RepoOperations(c.client).list_files(target.owner, target.repo, path=path, ref=ref)
        if isinstance(raw, dict):
            return f"`{path}` 是一个文件（{raw.get('size', '?')} 字节），请改用 gitea_get_file 读取。"
        entries = list(raw or [])
        if not entries:
            return f"目录 `{path or '/'}` 为空。"
        lines = [
            f"- {'📁' if entry.get('type') == 'dir' else '📄'} `{entry.get('path')}`"
            + (f"（{entry.get('size')} 字节）" if entry.get("type") != "dir" and entry.get("size") is not None else "")
            for entry in entries
        ]
        return c.truncate(f"`{path or '/'}` 下共 {len(entries)} 项：\n" + "\n".join(lines))

    @tool(server, name="gitea_get_file", title="读取文件")
    async def gitea_get_file(
        filePath: Annotated[str, Field(min_length=1, description="仓库内文件路径，例如 src/main.ts。")],
        owner: _owner = None,
        repo: _repo = None,
        ref: Annotated[str | None, Field(description="分支名 / 标签 / 提交 SHA。")] = None,
    ) -> str:
        """读取仓库中指定文件的文本内容（自动 base64 解码），同时返回文件 blob SHA，便于后续更新。"""
        c = ctx()
        target = _resolve(owner, repo)
        detail = await RepoOperations(c.client).get_file(
            target.owner, target.repo, file_path=filePath, ref=ref
        )
        content = detail.get("decoded_content") or ""
        header = (
            f"# {detail.get('path') or filePath}"
            f"（{detail.get('size', '?')} 字节，sha `{detail.get('sha', '')[:10]}`）\n\n"
        )
        return c.truncate(f"{header}```\n{content}\n```")

    @tool(server, name="gitea_get_commit_status", title="查询提交状态")
    async def gitea_get_commit_status(
        ref: Annotated[str, Field(min_length=1, description="分支名 / 标签 / 提交 SHA。")],
        owner: _owner = None,
        repo: _repo = None,
    ) -> str:
        """查询某个分支 / 标签 / 提交的 CI 合并状态（Gitea 工作流等）。返回 overall 状态与每个检查项的明细，可用于判断 PR 是否通过检查。"""
        c = ctx()
        target = _resolve(owner, repo)
        status = await RepoOperations(c.client).commit_status(target.owner, target.repo, ref)
        lines = [f"**{target.full_name}** `{ref}` 的合并状态：`{status.get('state') or '未知'}`"]
        rows: Sequence[dict[str, Any]] = status.get("statuses") or []
        for row in rows:
            lines.append(
                f"- {row.get('status')} · {row.get('context') or row.get('name') or '检查'}"
                f" —— {row.get('description') or ''}".rstrip()
            )
            if row.get("target_url"):
                lines.append(f"  {row['target_url']}")
        if not rows:
            lines.append("- （还没有任何检查项）")
        return c.truncate("\n".join(lines))

    @tool(server, name="gitea_commit_file", title="提交文件", read_only=False)
    async def gitea_commit_file(
        filePath: Annotated[str, Field(min_length=1, description="仓库内文件路径。")],
        content: Annotated[str, Field(description="文件完整文本内容（无需 base64）。")],
        owner: _owner = None,
        repo: _repo = None,
        message: Annotated[str | None, Field(description="提交信息。")] = None,
        branch: Annotated[str | None, Field(description="目标分支；省略时使用仓库默认分支。")] = None,
        newBranch: Annotated[str | None, Field(description="提供时会在该新分支上提交。")] = None,
    ) -> str:
        """在仓库中创建或更新一个文件并提交。文件已存在时自动带上 blob SHA 执行更新。可通过 `newBranch` 把改动提交到新分支。"""
        c = ctx()
        target = _resolve(owner, repo)
        result = await RepoOperations(c.client).commit_file(
            target.owner,
            target.repo,
            file_path=filePath,
            content=content,
            message=message,
            branch=branch,
            new_branch=newBranch,
        )
        commit = result.get("commit") or {}
        return (
            f"已提交 `{filePath}` 到 **{target.full_name}**\n"
            f"- 分支：`{branch or newBranch or '默认分支'}`\n"
            f"- 提交：`{commit.get('sha', '')[:10]}` {commit.get('message', '')}"
        )


__all__ = ["register"]
