"""错误类型（与 TS 版 `src/core/errors.ts` 一一对应）。"""

from __future__ import annotations

from typing import Any


class GiteaToolkitError(Exception):
    """本包所有错误的基类。"""


class GiteaConfigError(GiteaToolkitError):
    """配置缺失或非法（例如未填实例地址）。"""


class GiteaApiError(GiteaToolkitError):
    """Gitea 返回了非 2xx 响应。

    Attributes:
        message: 人类可读描述（已按状态码归一化，例如 401 会提示令牌失效）。
        status: HTTP 状态码。
        endpoint: 形如 ``GET /repos/o/r/issues``，便于用户定位。
        body: 响应体片段（已截断），仅用于诊断。
    """

    def __init__(self, message: str, status: int, endpoint: str, body: str = "") -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.endpoint = endpoint
        self.body = body

    def __str__(self) -> str:
        detail = f"{self.message}（{self.endpoint}，HTTP {self.status}）"
        if self.body:
            detail += f"\n响应片段：{self.body[:500]}"
        return detail

    def to_dict(self) -> dict[str, Any]:
        """结构化形式，便于工具层放进 structured content。"""
        return {
            "message": self.message,
            "status": self.status,
            "endpoint": self.endpoint,
        }


def describe_error(error: BaseException) -> str:
    """把任意异常转成面向用户的单行说明。

    工具层统一用它包装错误，保证报错措辞一致、不带 Python 堆栈噪音。
    """
    if isinstance(error, GiteaApiError):
        return str(error)
    if isinstance(error, GiteaConfigError):
        return str(error)
    if isinstance(error, GiteaToolkitError):
        return str(error)
    return f"{type(error).__name__}: {error}"
