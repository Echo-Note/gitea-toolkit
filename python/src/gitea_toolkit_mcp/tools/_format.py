"""工具层共用的格式化助手（对应 TS 版 `src/ai/tools/helpers.ts`）。

集中放在一处的原因与 TS 版相同：Issue / PR / Actions 三个域都要生成**同样的** Markdown 行，
分散写就会各自漂移 —— 而两个实现的返回文本是要能互换的（同一份提示词在两边都该说得通）。
"""

from __future__ import annotations

from typing import Any
from collections.abc import Mapping

# relative_time 定义在 _shared（上下文相关），这里转出，工具模块只 import 本模块即可
from ._shared import relative_time

__all__ = [
    "action_state_label",
    "format_artifact_line",
    "format_body",
    "format_bytes",
    "format_comment",
    "format_issue_line",
    "format_job_line",
    "format_pull_line",
    "format_run_line",
    "format_workflow_line",
    "relative_time",
    "tail_lines",
    "truncate",
]

#: 正文（description / 评论）在工具返回里的默认长度上限
DEFAULT_BODY_MAX = 8000


def _login(user: Mapping[str, Any] | None) -> str:
    """从用户对象里取登录名；缺失时用 ``unknown`` 占位（与 TS 版一致）。"""
    if isinstance(user, Mapping):
        return str(user.get("login") or "unknown")
    return "unknown"


def truncate(text: str, max_length: int) -> str:
    """按显式上限截断，并说明原始长度（不要静默截断）。"""
    if max_length <= 0 or len(text) <= max_length:
        return text
    return text[:max_length] + f"\n…（已截断：共 {len(text)} 字符，仅返回前 {max_length} 字符）"


def format_bytes(size: Any) -> str:
    """把字节数格式化为易读字符串。"""
    if not isinstance(size, (int, float)) or isinstance(size, bool) or size < 0:
        return "未知大小"
    if size < 1024:
        return f"{int(size)} B"
    value = float(size) / 1024
    units = ["KB", "MB", "GB", "TB"]
    unit = 0
    while value >= 1024 and unit < len(units) - 1:
        value /= 1024
        unit += 1
    return f"{value:.1f} {units[unit]}"


def format_issue_line(issue: Mapping[str, Any]) -> str:
    """生成 Issue / PR 的 Markdown 列表行。

    **跨仓库检索时必须带上仓库名**：``/repos/issues/search`` 的返回里每条都带
    ``repository`` 字段，而单仓库接口的返回里没有。不带仓库名的话，
    「分配给我的 Issue」这种跨仓库用法会返回一堆看不出属于谁的问题 ——
    有了仓库名，模型才能接着调 ``gitea_get_issue``（那需要 owner/repo）。
    """
    kind = "PR" if issue.get("pull_request") else "Issue"
    repository = issue.get("repository")
    repo_name = repository.get("full_name") if isinstance(repository, Mapping) else None
    where = f"**{repo_name}** " if repo_name else ""
    labels = " ".join(f"`{label.get('name')}`" for label in (issue.get("labels") or []))
    assignees = ", ".join(_login(user) for user in (issue.get("assignees") or []))
    extras: list[str] = []
    if labels:
        extras.append(labels)
    if assignees:
        extras.append(f"指派 {assignees}")
    if issue.get("comments"):
        extras.append(f"{issue['comments']} 条评论")
    suffix = f"\n  {' · '.join(extras)}" if extras else ""
    return (
        f"- {where}#{issue.get('number')} [{kind}] **{issue.get('title')}**"
        f"（{issue.get('state')}，@{_login(issue.get('user'))}，{relative_time(issue.get('updated_at'))}）{suffix}"
    )


def format_pull_line(pull: Mapping[str, Any]) -> str:
    """生成 PR 的 Markdown 列表行。"""
    head = (pull.get("head") or {}).get("ref")
    base = (pull.get("base") or {}).get("ref")
    branch = f"{head} → {base}" if head and base else ""
    flags: list[str] = []
    if pull.get("draft"):
        flags.append("草稿")
    if pull.get("merged"):
        flags.append("已合并")
    flags.append(str(pull.get("state")))
    return (
        f"- #{pull.get('number')} **{pull.get('title')}**"
        f"（{'/'.join(flags)}{f'，{branch}' if branch else ''}，"
        f"@{_login(pull.get('user'))}，{relative_time(pull.get('updated_at'))}）"
    )


def format_comment(comment: Mapping[str, Any], index: int) -> str:
    """生成评论的 Markdown 摘要。"""
    body = str(comment.get("body") or "").strip()
    return (
        f"**{index}. @{_login(comment.get('user'))}**"
        f"（{relative_time(comment.get('created_at'))}）\n\n{body}"
    )


def format_body(body: Any, max_length: int = DEFAULT_BODY_MAX) -> str:
    """规范化正文：空正文给出明确占位，过长按上限截断。"""
    text = str(body or "").strip()
    if not text:
        return "_（无正文）_"
    return truncate(text, max_length)


def action_state_label(status: Any = None, conclusion: Any = None) -> str:
    """把 Actions 的状态 / 结论翻译成人类可读的中文标签。

    Gitea 的 ``status`` 与 ``conclusion`` 是两套取值（运行中看 status，结束后看 conclusion），
    这里合并成一个标签，避免模型把 ``completed`` 当成「成功」。
    """
    mapping = {
        "success": "成功",
        "failure": "失败",
        "cancelled": "已取消",
        "skipped": "已跳过",
        "neutral": "中性",
        "timed_out": "超时",
        "action_required": "需要处理",
        "running": "运行中",
        "in_progress": "运行中",
        "queued": "排队中",
        "waiting": "等待中",
        "completed": "已完成",
    }
    key = str(conclusion or "").strip() or str(status or "").strip()
    if not key:
        return "未知"
    return mapping.get(key, key)


def format_workflow_line(workflow: Mapping[str, Any]) -> str:
    """生成工作流的 Markdown 列表行。"""
    state = workflow.get("state")
    enabled = "已启用" if state == "active" else f"已停用（{state}）"
    return (
        f"- **{workflow.get('name')}**（`{workflow.get('path')}`，{enabled}）\n"
        f"  ID `{workflow.get('id')}`，更新于 {relative_time(workflow.get('updated_at'))}"
    )


def format_run_line(run: Mapping[str, Any]) -> str:
    """生成运行记录的 Markdown 列表行。"""
    title = run.get("display_title") or run.get("path") or "(无标题)"
    branch = f"，`{run['head_branch']}`" if run.get("head_branch") else ""
    event = f"，{run['event']}" if run.get("event") else ""
    actor = run.get("actor") or {}
    who = f"，@{actor.get('login')}" if actor.get("login") else ""
    number = run.get("run_number") or run.get("id")
    return (
        f"- **#{number}** [{action_state_label(run.get('status'), run.get('conclusion'))}] "
        f"{title}{event}{branch}{who}"
        f"（{relative_time(run.get('started_at') or run.get('completed_at'))}）\n"
        f"  run id `{run.get('id')}`"
    )


def format_job_line(job: Mapping[str, Any]) -> str:
    """生成作业的 Markdown 列表行。"""
    runner = f"，运行器 {job['runner_name']}" if job.get("runner_name") else ""
    return (
        f"- **{job.get('name')}** [{action_state_label(job.get('status'), job.get('conclusion'))}]"
        f"{runner}（{relative_time(job.get('started_at') or job.get('completed_at'))}）\n"
        f"  job id `{job.get('id')}`"
    )


def format_artifact_line(artifact: Mapping[str, Any]) -> str:
    """生成产物的 Markdown 列表行。"""
    expired = "，**已过期**" if artifact.get("expired") else ""
    return (
        f"- **{artifact.get('name')}**"
        f"（{format_bytes(artifact.get('size_in_bytes'))}{expired}，"
        f"创建于 {relative_time(artifact.get('created_at'))}）\n"
        f"  ID `{artifact.get('id')}`"
    )


def tail_lines(text: str, max_lines: int) -> tuple[str, bool]:
    """取文本的最后若干行。

    作业日志动辄上千行，而**出错信息几乎总在末尾**，因此默认保留尾部而非头部。
    """
    lines = text.splitlines()
    if len(lines) <= max_lines:
        return text, False
    return "\n".join(lines[len(lines) - max_lines :]), True
