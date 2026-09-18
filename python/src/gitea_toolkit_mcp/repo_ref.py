"""从当前工作目录的 git 远端推断仓库（移植自 TS 版 `src/mcpServer/gitRemote.ts`）。

设计意图：多数工具不必显式传 ``owner`` / ``repo`` —— 用户在 Gitea 仓库目录下启动服务时，
可以直接说「列出最近的 Issue」。``origin`` 指向该 Gitea 实例时生效，SSH 与 HTTP(S) 都支持。
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from urllib.parse import urlparse

#: git@host:owner/repo.git
_SCP_LIKE = re.compile(r"^(?P<user>[^@/]+)@(?P<host>[^:/]+):(?P<path>.+?)(?:\.git)?/?$")
#: ssh://git@host[:port]/owner/repo.git 或 https://host/owner/repo.git
_URL_LIKE = re.compile(r"^(?:ssh|git|https?)://(?:(?P<user>[^@/]+)@)?(?P<host>[^:/]+)(?::\d+)?/(?P<path>.+?)(?:\.git)?/?$")


@dataclass(frozen=True)
class RepoRef:
    """仓库坐标。"""

    owner: str
    repo: str

    @property
    def full_name(self) -> str:
        return f"{self.owner}/{self.repo}"

    def __str__(self) -> str:  # pragma: no cover - 仅用于日志
        return self.full_name


def parse_remote_url(url: str) -> RepoRef | None:
    """解析 git 远端 URL。

    支持 ``git@host:owner/repo.git``、``ssh://git@host/owner/repo.git``、
    ``https://host/owner/repo.git`` 三种形式；路径含多级（如 GitLab 的子组）时
    取**最后两段**作为 owner/repo —— Gitea 的 owner 是单段。

    Args:
        url: 远端地址
    """
    if not url:
        return None
    candidate = url.strip()
    match = _SCP_LIKE.match(candidate) or _URL_LIKE.match(candidate)
    if not match:
        return None
    path = match.group("path").strip("/")
    segments = [segment for segment in path.split("/") if segment]
    if len(segments) < 2:
        return None
    return RepoRef(owner=segments[-2], repo=segments[-1])


def _remote_host(url: str) -> str | None:
    """取出远端的主机名（用于确认它确实指向同一个 Gitea 实例）。"""
    candidate = (url or "").strip()
    match = _SCP_LIKE.match(candidate)
    if match:
        return match.group("host").lower()
    parsed = urlparse(candidate)
    return (parsed.hostname or "").lower() or None


def resolve_default_repo(server_url: str, *, cwd: str | None = None) -> RepoRef | None:
    """从当前目录的 ``origin`` 推断仓库；推断不出或主机不匹配时返回 None。

    Args:
        server_url: 已配置的 Gitea 实例地址（用于校验远端是否指向同一个实例）
        cwd: 工作目录，默认当前进程的 cwd
    """
    try:
        completed = subprocess.run(
            ["git", "config", "--get", "remote.origin.url"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    remote = completed.stdout.strip()
    if completed.returncode != 0 or not remote:
        return None

    ref = parse_remote_url(remote)
    if ref is None:
        return None

    expected_host = urlparse(server_url).hostname or ""
    actual_host = _remote_host(remote) or ""
    if expected_host and actual_host and expected_host.lower() != actual_host:
        # origin 指向别的平台（例如 GitHub 镜像）时，不要拿它去猜 Gitea 仓库
        return None
    return ref


def resolve_repo_ref(
    owner: str | None,
    repo: str | None,
    server_url: str,
) -> RepoRef:
    """确定本次调用作用在哪个仓库。

    显式给了 owner+repo 就用它；否则从工作目录推断；都拿不到时抛出带指引的错误。

    Args:
        owner: 显式传入的仓库所属者
        repo: 显式传入的仓库名
        server_url: 已配置的实例地址

    Raises:
        ValueError: 既没显式指定、也无法从工作目录推断时
    """
    if owner and repo:
        return RepoRef(owner=owner, repo=repo)
    inferred = resolve_default_repo(server_url)
    if inferred is None:
        raise ValueError(
            "未指定仓库，且无法从当前工作目录推断：请显式传 owner 与 repo，"
            "或在某个 Gitea 仓库目录下启动本服务（服务会读取 origin 远端）"
        )
    return RepoRef(
        owner=owner or inferred.owner,
        repo=repo or inferred.repo,
    )


__all__ = ["RepoRef", "parse_remote_url", "resolve_default_repo", "resolve_repo_ref"]
