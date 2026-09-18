"""工具层的共享上下文与格式化助手。

为什么用模块级上下文：MCPServer 的工具是普通函数（FastMCP 风格），注册时无法携带
额外对象；而本服务是**单进程 stdio**，一个上下文足够。装配时由 ``build_server`` 注入。
"""

from __future__ import annotations

import math
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Annotated

from pydantic import Field

from ..client import GiteaClient
from ..repo_ref import RepoRef, resolve_repo_ref
from ..version import (
    CompatibilityResult,
    compatibility_notice,
    evaluate_compatibility,
)

#: ``owner`` / ``repo`` 两个入参的公共片段。
#:
#: 放在这里而不是各工具模块各写一遍：这两段文案必须**逐字一致** ——
#: 同一个字段在 Issue 域与 PR 域显示出不同描述，会让模型对「省略会怎样」产生分歧。
OWNER_ARG = Annotated[
    str | None,
    Field(description="仓库所属者（用户名或组织名）。省略时使用当前工作区推断出的仓库。"),
]
REPO_ARG = Annotated[
    str | None,
    Field(description="仓库名。省略时使用当前工作区推断出的仓库。"),
]


@dataclass
class ToolContext:
    """工具执行所需的一切。"""

    client: GiteaClient
    server_url: str
    max_output_length: int

    # ── 版本兼容性监测（惰性探测 + 只提示一次）──────────────────
    #: 是否已探测过（**失败也算探过**：版本探测是锦上添花，不该每次调用都重试）
    _compat_probed: bool = field(default=False, init=False, repr=False)
    #: 判定结果；探测失败保持 None
    _compat_result: CompatibilityResult | None = field(default=None, init=False, repr=False)
    #: 已提示过的「等级 + 版本」，用于去重
    _compat_announced: str | None = field(default=None, init=False, repr=False)

    def truncate(self, text: str) -> str:
        """按配置上限截断输出，并明确告知被截断（而不是静默丢失）。"""
        limit = self.max_output_length
        if limit <= 0 or len(text) <= limit:
            return text
        return (
            text[:limit]
            + f"\n…（输出超过 {limit} 字符已截断；可调大 --max-output / GITEA_MAX_OUTPUT_LENGTH）"
        )

    async def compatibility(self) -> CompatibilityResult | None:
        """取（并缓存）服务端版本兼容性判定。

        取不到版本时返回 ``None`` 且**不抛异常**：拿不到版本号不应该让工具调用失败，
        只在 stderr 留一行，便于排查。

        服务端版本在进程生命周期内不会变，所以只探测一次；stdio 传输下工具调用是串行的，
        因此不需要加锁。
        """
        if not self._compat_probed:
            self._compat_probed = True
            try:
                # 局部导入：避免 `tools` ↔ `operations` 在模块级互相牵扯
                from ..operations import AccountOperations

                raw = await AccountOperations(self.client).server_version()
            except Exception as error:  # noqa: BLE001 - 探测失败不影响工具
                print(
                    f"[gitea-toolkit-mcp] 读取服务端版本失败，跳过兼容性检查：{error}",
                    file=sys.stderr,
                )
                return None
            self._compat_result = evaluate_compatibility(raw)
            print(
                f"[gitea-toolkit-mcp] 服务端 Gitea 版本 {self._compat_result.actual}"
                f" → 兼容性 {self._compat_result.level}"
                f"（已核对 {self._compat_result.verified}）",
                file=sys.stderr,
            )
        return self._compat_result

    async def take_compatibility_notice(self) -> str:
        """取「本次需要插进工具返回」的兼容性提示；兼容或已提示过时返回空串。

        为什么只提示一次：版本在一次会话里不会变，每次调用都重复同一句话既费 token，
        又会让模型把它当噪音忽略 —— 与扩展侧「同一等级+版本只弹一次」的口径一致。
        """
        result = await self.compatibility()
        if result is None or not result.should_warn:
            return ""
        key = f"{result.level}:{result.actual}"
        if self._compat_announced == key:
            return ""
        self._compat_announced = key
        return compatibility_notice(result) + "\n\n"


_context: ToolContext | None = None


def set_context(context: ToolContext) -> None:
    """装配时注入上下文。"""
    global _context
    _context = context


def ctx() -> ToolContext:
    """取当前上下文；未装配时说明是内部错误而不是抛裸异常。"""
    if _context is None:
        raise RuntimeError("工具上下文尚未初始化（内部错误：build_server 未先调用 set_context）")
    return _context


def resolve_repo(owner: str | None, repo: str | None) -> RepoRef:
    """解析本次调用作用在哪个仓库（显式参数优先，其次从工作目录的 git origin 推断）。

    Raises:
        ValueError: 既没显式给全、也无法从工作目录推断时
    """
    return resolve_repo_ref(owner, repo, ctx().server_url)


#: 相对时间的单位换算表（与 TS 版 `src/core/format.ts` 的 units 逐项一致）
_TIME_UNITS: tuple[tuple[int, str], ...] = (
    (60, "秒"),
    (60, "分钟"),
    (24, "小时"),
    (30, "天"),
    (12, "个月"),
)


def _js_round(value: float) -> int:
    """按 JavaScript ``Math.round`` 的规则取整。

    Python 的 ``round`` 是**银行家舍入**（``round(0.5) == 0``），JS 是「四舍五入」，
    两边在 ``.5`` 上会差 1 —— 对「90 秒算 1 分钟还是 2 分钟」这类展示是有影响的，
    所以显式对齐，而不是将就。
    """
    return math.floor(value + 0.5)


def relative_time(value: str | None) -> str:
    """把 ISO 时间转成「3 天前」这类相对表述。

    与 TS 版 `src/core/format.ts` 的 ``relativeTime`` **逐字对齐**（返回文本要在两个实现
    之间可互换）。四个容易写歪的点，都按 TS 的口径来：

    - 空值返回 ``'-'``（不是空串）；
    - 解析不了就原样返回；
    - **永远**用相对表述（超过 30 天也不退化成绝对日期，会变成「3 个月前」）；
    - 单位换算用四舍五入，且未来时间用「后」（``5 分钟后``）。

    ⚠️ 改动前 Python 版这四处都与 TS 不一致，且是被跨语言比对测试抓出来的。
    """
    if not value:
        return "-"
    normalized = value.replace("Z", "+00:00")
    try:
        moment = datetime.fromisoformat(normalized)
    except ValueError:
        return value
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)

    diff_seconds = _js_round((datetime.now(timezone.utc) - moment).total_seconds())
    amount: float = abs(diff_seconds)
    unit = "秒"
    for factor, name in _TIME_UNITS:
        unit = name
        if amount < factor:
            break
        amount = _js_round(amount / factor)
    suffix = "前" if diff_seconds >= 0 else "后"
    return f"{int(amount)} {unit}{suffix}"


__all__ = [
    "OWNER_ARG",
    "REPO_ARG",
    "ToolContext",
    "ctx",
    "relative_time",
    "resolve_repo",
    "set_context",
]
