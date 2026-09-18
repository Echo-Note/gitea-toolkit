"""Gitea 服务端版本解析与兼容性判定（移植自 TS 版 `src/core/version.ts`）。

**两侧必须逐字一致**：同一台服务端、同一份提示，换个实现就得出不同结论是说不过去的。
因此常量、判定口径与**面向模型的措辞**都照抄 TS 版，并有测试直接读 TS 源文件比对
（见 `tests/test_smoke.py` 的 `test_version_constants_match_typescript`）。

本模块只做「版本号 → 判定结果」的纯计算，不碰网络 —— 取版本、缓存、只提示一次
这些编排在 `tools/_shared.py` 的 ``ToolContext`` 里。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

#: 已**逐项核对过**的 Gitea 版本：`operations/` 下所有端点的路径、参数与响应字段，
#: 都以该版本的 OpenAPI 规范（`https://<host>/swagger.v1.json`）为准核对过。
VERIFIED_GITEA_VERSION = "1.26.4"

#: 可运行的**最低** Gitea 版本。
#:
#: 选择理由：1.21 是 Gitea 的 LTS 分支，本服务用到的全部端点
#: （`/repos/issues/search`、`/repos/{owner}/{repo}/pulls/{index}.diff`、
#: `PUT /notifications`、`PUT /issues/{index}/labels` 等）在该版本均已可用且语义一致；
#: 更早版本未经验证。
MIN_SUPPORTED_GITEA_VERSION = "1.21.0"

#: 兼容性等级。
CompatibilityLevel = Literal["ok", "newer", "older", "unsupported", "unknown"]

_VERSION_PATTERN = re.compile(r"(\d+)\.(\d+)(?:\.(\d+))?")

#: 提示开头：明确要求模型转达，否则模型很可能只当成背景信息
_NOTICE_HEAD = "⚠️ **服务端 Gitea 版本兼容性提示 —— 请转达给用户**："

#: 提示结尾：给出「随时复查」的入口，并说明只出现一次
_NOTICE_TAIL = "（该提示每个会话只出现一次；可用 `gitea_get_current_user` 复查服务端版本。）"


@dataclass(frozen=True)
class ParsedVersion:
    """解析后的版本号。"""

    major: int
    minor: int
    patch: int
    raw: str

    def __str__(self) -> str:
        return f"{self.major}.{self.minor}.{self.patch}"


@dataclass(frozen=True)
class CompatibilityResult:
    """兼容性判定结果。"""

    level: CompatibilityLevel
    #: 服务端实际版本（可解析时归一化为 `major.minor.patch`，否则是原文）
    actual: str
    #: 已核对的版本
    verified: str
    #: 面向用户的中文说明（Python 侧主要用于日志；给模型的措辞见 ``compatibility_notice``）
    message: str
    #: 是否需要提示
    should_warn: bool


def parse_version(raw: str | None) -> ParsedVersion | None:
    """解析 Gitea 版本字符串。

    容错处理常见变体：``1.26.4``、``v1.26.4``、``1.26.4+dev``、``1.22.0-rc1``、
    ``1.26.4 (git: abcdef)``、``1.26``。
    """
    if not raw or not isinstance(raw, str):
        return None
    match = _VERSION_PATTERN.search(raw.strip())
    if match is None:
        return None
    major, minor, patch = match.groups()
    return ParsedVersion(
        major=int(major),
        minor=int(minor),
        patch=int(patch) if patch else 0,
        raw=raw.strip(),
    )


def compare_versions(left: ParsedVersion, right: ParsedVersion) -> int:
    """比较版本号：``left > right`` 返回正数，相等返回 0，小于返回负数。"""
    left_key = (left.major, left.minor, left.patch)
    right_key = (right.major, right.minor, right.patch)
    if left_key == right_key:
        return 0
    return 1 if left_key > right_key else -1


def evaluate_compatibility(raw_version: str | None) -> CompatibilityResult:
    """判定服务端版本与本服务的兼容性。

    只比较**主次版本**：同一 ``major.minor`` 下的补丁差异视为兼容
    （Gitea 的补丁版本不做破坏性变更）。
    """
    actual = parse_version(raw_version)
    verified = parse_version(VERIFIED_GITEA_VERSION)
    minimum = parse_version(MIN_SUPPORTED_GITEA_VERSION)
    raw_text = (raw_version or "").strip()

    # 这两个常量是我们自己写的，解析不了属于编码错误，直接抛出来
    assert verified is not None and minimum is not None

    if actual is None:
        return CompatibilityResult(
            level="unknown",
            actual=raw_text or "（未返回）",
            verified=VERIFIED_GITEA_VERSION,
            message=(
                f"无法识别服务端返回的 Gitea 版本号：{raw_text or '（空）'}。\n\n"
                f"本服务的接口调用以 Gitea {VERIFIED_GITEA_VERSION} 为准核对，请自行确认兼容性。"
            ),
            should_warn=True,
        )

    if compare_versions(actual, minimum) < 0:
        return CompatibilityResult(
            level="unsupported",
            actual=str(actual),
            verified=VERIFIED_GITEA_VERSION,
            message=(
                f"服务端 Gitea 版本为 {actual}，低于本服务要求的最低版本 "
                f"{MIN_SUPPORTED_GITEA_VERSION}。\n\n"
                "部分接口可能不存在或语义不同，功能可能异常。建议升级 Gitea 服务端。"
            ),
            should_warn=True,
        )

    if actual.major == verified.major and actual.minor == verified.minor:
        return CompatibilityResult(
            level="ok",
            actual=str(actual),
            verified=VERIFIED_GITEA_VERSION,
            message=f"Gitea {actual} 与本服务已核对的版本一致。",
            should_warn=False,
        )

    is_newer = actual.major > verified.major or (
        actual.major == verified.major and actual.minor > verified.minor
    )
    if is_newer:
        return CompatibilityResult(
            level="newer",
            actual=str(actual),
            verified=VERIFIED_GITEA_VERSION,
            message=(
                f"服务端 Gitea 版本为 {actual}，高于本服务已核对的 {VERIFIED_GITEA_VERSION}。\n\n"
                "接口可能已发生变化，若出现功能异常请反馈。"
            ),
            should_warn=True,
        )

    return CompatibilityResult(
        level="older",
        actual=str(actual),
        verified=VERIFIED_GITEA_VERSION,
        message=(
            f"服务端 Gitea 版本为 {actual}，低于本服务已核对的 {VERIFIED_GITEA_VERSION}。\n\n"
            "较新版本引入的部分接口能力可能不可用（例如 PR 分支引用字段、通知批量状态等），"
            "功能可能受限。"
        ),
        should_warn=True,
    )


def compatibility_status_line(result: CompatibilityResult | None) -> str:
    """兼容性状态的一行摘要（供 ``gitea_get_current_user`` 这类自查工具展示）。

    措辞**刻意保持中性**（不写「本扩展」/「本 MCP」），与 TS 版逐字一致。
    """
    if result is None:
        return "（读取失败，不影响本次调用）"
    return f"{result.actual}｜兼容性 `{result.level}`（已核对 {result.verified}）"


def compatibility_notice(result: CompatibilityResult) -> str:
    """给**模型**看的兼容性提示（对应 TS 版 `src/mcpServer/compatibility.ts` 的 ``compatibilityNotice``）。

    为什么单写一份而不用 ``result.message``：``message`` 是给**扩展用户**看的
    （「本扩展已核对 …」），放进 MCP 返回里说不通。这里只用判定结果自行组织措辞，
    并且与 TS 版的输出**逐字相同** —— 两个实现的工具返回是要求可互换的。
    """
    if result.level == "unsupported":
        detail = (
            f"服务端为 {result.actual}，低于本 MCP 要求的最低版本 {MIN_SUPPORTED_GITEA_VERSION}。"
            "部分接口可能不存在或语义不同，工具调用可能失败 —— **建议用户升级 Gitea 服务端**。"
        )
    elif result.level == "older":
        detail = (
            f"服务端为 {result.actual}，低于本 MCP 已核对的 {VERIFIED_GITEA_VERSION}。"
            "较新版本引入的部分能力可能不可用（例如 PR 的分支引用字段、通知的批量状态），"
            "工具行为可能受限。"
        )
    elif result.level == "newer":
        detail = (
            f"服务端为 {result.actual}，高于本 MCP 已核对的 {VERIFIED_GITEA_VERSION}。"
            "接口可能已发生变化，若出现异常请用户反馈。"
        )
    else:
        detail = (
            f"无法识别服务端返回的版本号（原文：{result.actual}）。"
            f"本 MCP 的接口以 Gitea {VERIFIED_GITEA_VERSION} 为准核对，请用户自行确认兼容性。"
        )
    return f"{_NOTICE_HEAD}{detail}\n{_NOTICE_TAIL}"


__all__ = [
    "MIN_SUPPORTED_GITEA_VERSION",
    "VERIFIED_GITEA_VERSION",
    "CompatibilityLevel",
    "CompatibilityResult",
    "ParsedVersion",
    "compare_versions",
    "compatibility_notice",
    "compatibility_status_line",
    "evaluate_compatibility",
    "parse_version",
]
