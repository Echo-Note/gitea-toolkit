"""Gitea API 客户端（移植自 TS 版 `src/core/giteaClient.ts`，语义保持一致）。

只负责：URL 拼装、认证头注入、JSON 序列化/反序列化、错误归一化、分页信息解析。
业务语义在 ``operations`` 层。
"""

from __future__ import annotations

import json
import ssl
from dataclasses import dataclass, field
from typing import Any
from collections.abc import Callable, Mapping, Sequence
from urllib.parse import urlencode

import httpx2

from .errors import GiteaApiError, GiteaConfigError

#: 单页条数的兜底上限。
#:
#: Gitea 的服务端配置 ``max_response_items``（``GET /settings/api`` 可查）默认为 50，
#: 超出部分会被服务端**静默丢弃**。这里用同一默认值，避免发出注定被截断的请求。
DEFAULT_MAX_RESPONSE_ITEMS = 50

DEFAULT_TIMEOUT_MS = 20_000

#: 请求身份标识（与 TS 版 MCP 的 ``gitea-toolkit-mcp`` 完全一致）。
#:
#: ⚠️ **绝不能带上 ``python`` 字样**：实测某实例的**前置 nginx 按 UA 关键字拦截**，
#: 只要 UA 里出现 ``python``（``Python-urllib/3.11``、``gitea-toolkit-mcp-python`` 都算）
#: 就直接返回 **403 Forbidden**（HTML 由 nginx 生成，不是 Gitea 的 JSON 错误）。
#: 这个 403 极易被误读成「令牌权限不足」—— 它跟令牌毫无关系。
#: 同类坑还有一个：**完全不发 UA**（或空 UA）同样被拦，所以不能把它设成空串。
DEFAULT_USER_AGENT = "gitea-toolkit-mcp"


@dataclass
class PageInfo:
    """分页元信息。"""

    total_count: int | None = None
    has_next_page: bool = False


@dataclass
class ListResult:
    """按页收集后的结果。"""

    items: list[Any] = field(default_factory=list)
    page_info: PageInfo = field(default_factory=PageInfo)


def _build_ssl_context() -> ssl.SSLContext:
    """构造「跳过证书校验」的 SSL 上下文。

    刻意自己建上下文而不是传 ``verify=False``：SDK v2 的 httpx2 改用操作系统信任库，
    字符串/布尔形式的 verify 语义在过渡期不稳定；自己给 context 在 httpx 与 httpx2
    下行为一致。
    """
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    return context


class GiteaClient:
    """Gitea REST API 客户端（异步）。"""

    def __init__(
        self,
        server_url: str,
        *,
        token: str | None = None,
        verify_tls: bool = True,
        timeout_ms: int = DEFAULT_TIMEOUT_MS,
        user_agent: str = DEFAULT_USER_AGENT,
    ) -> None:
        normalized = (server_url or "").strip().rstrip("/")
        if not normalized:
            raise GiteaConfigError("未配置 Gitea 实例地址，请设置 gitea.serverUrl / --url / GITEA_SERVER_URL")
        if not normalized.lower().startswith(("http://", "https://")):
            raise GiteaConfigError(f"Gitea 实例地址必须以 http:// 或 https:// 开头：{normalized}")
        self.server_url = normalized
        self._token = (token or "").strip() or None
        self._verify_tls = verify_tls is not False
        self._timeout_ms = timeout_ms if timeout_ms and timeout_ms > 0 else DEFAULT_TIMEOUT_MS
        self._user_agent = user_agent
        self._client: httpx2.AsyncClient | None = None

    # ── 生命周期 ────────────────────────────────────────────────

    @property
    def has_token(self) -> bool:
        """是否已配置访问令牌。"""
        return self._token is not None

    async def _ensure_client(self) -> httpx2.AsyncClient:
        if self._client is None:
            self._client = httpx2.AsyncClient(
                verify=True if self._verify_tls else _build_ssl_context(),
                timeout=self._timeout_ms / 1000,
                follow_redirects=True,
            )
        return self._client

    async def aclose(self) -> None:
        """释放底层连接（服务退出时调用）。"""
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    # ── 请求 ────────────────────────────────────────────────────

    async def request(
        self,
        method: str,
        path: str,
        *,
        query: Mapping[str, Any] | None = None,
        body: Any = None,
        response_type: str = "json",
        timeout_ms: int | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> Any:
        """发起一次 API 请求并返回解析后的响应体。"""
        data, _ = await self.request_with_meta(
            method,
            path,
            query=query,
            body=body,
            response_type=response_type,
            timeout_ms=timeout_ms,
            headers=headers,
        )
        return data

    async def request_with_meta(
        self,
        method: str,
        path: str,
        *,
        query: Mapping[str, Any] | None = None,
        body: Any = None,
        response_type: str = "json",
        timeout_ms: int | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> tuple[Any, PageInfo]:
        """发起一次 API 请求，并返回响应体与分页信息。"""
        url = self._build_url(path, query)
        endpoint = f"{method.upper()} {path}"
        request_headers: dict[str, str] = {
            "Accept": "application/json",
            "User-Agent": self._user_agent,
        }
        if headers:
            request_headers.update(headers)
        if self._token:
            # Gitea 的约定是 `Authorization: token <token>`（不是 Bearer）
            request_headers["Authorization"] = f"token {self._token}"

        content: bytes | None = None
        if body is not None:
            content = json.dumps(body, ensure_ascii=False).encode("utf-8")
            request_headers["Content-Type"] = "application/json"

        client = await self._ensure_client()
        try:
            response = await client.request(
                method.upper(),
                url,
                headers=request_headers,
                content=content,
                timeout=(timeout_ms / 1000) if timeout_ms else None,
            )
        except httpx2.HTTPError as error:
            raise GiteaApiError(
                f"请求失败：{type(error).__name__}",
                0,
                endpoint,
                str(error),
            ) from error

        text = response.text
        if not (200 <= response.status_code < 300):
            raise GiteaApiError(
                self._describe_status(response.status_code),
                response.status_code,
                endpoint,
                text,
            )

        page_info = _parse_page_info(response.headers)
        if response_type == "text" or response.status_code == 204 or not text:
            return text, page_info
        try:
            return json.loads(text), page_info
        except json.JSONDecodeError as error:
            raise GiteaApiError(
                f"响应不是合法 JSON：{error}",
                response.status_code,
                endpoint,
                text[:500],
            ) from error

    async def request_paged(
        self,
        method: str,
        path: str,
        *,
        limit: int,
        extract: Callable[[Any], Sequence[Any] | None],
        query: Mapping[str, Any] | None = None,
        body: Any = None,
        max_per_page: int | None = None,
        start_page: int = 1,
        timeout_ms: int | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> ListResult:
        """按页收集列表，直到凑够 ``limit`` 条、或服务端表示没有下一页。

        **为什么需要它**：Gitea 对单次请求的 ``limit`` 有服务端上限
        （``GET /settings/api`` 的 ``max_response_items``，官方默认 50），超出部分会被
        **静默丢弃** —— 请求 ``limit=200`` 实际只回 50 条且不报错。所以「想拿 200 条」
        必须真的发多次请求，只调大 limit 是无效的。

        Args:
            limit: 期望收集的总条数。
            extract: 从响应体里取出条目数组。
            query: 查询参数（**不要自带 page / limit**，由本方法接管）。
        """
        per_page = max(1, min(limit, max_per_page or DEFAULT_MAX_RESPONSE_ITEMS))
        items: list[Any] = []
        page = max(1, start_page)
        page_info = PageInfo()

        while len(items) < limit:
            effective_query = dict(query or {})
            effective_query["page"] = page
            effective_query["limit"] = per_page
            data, page_info = await self.request_with_meta(
                method,
                path,
                query=effective_query,
                body=body,
                timeout_ms=timeout_ms,
                headers=headers,
            )
            batch = list(extract(data) or [])
            items.extend(batch)
            # 空批次或没有下一页就停，避免服务端行为异常时无限翻页
            if not batch or not page_info.has_next_page:
                break
            page += 1

        return ListResult(items=items[:limit], page_info=page_info)

    # ── 内部 ────────────────────────────────────────────────────

    def _build_url(self, path: str, query: Mapping[str, Any] | None = None) -> str:
        """拼接完整请求 URL（数组参数展开为同名重复参数，符合 Gitea 约定）。"""
        normalized_path = path if path.startswith("/") else f"/{path}"
        url = f"{self.server_url}/api/v1{normalized_path}"
        if not query:
            return url
        pairs: list[tuple[str, str]] = []
        for key, value in query.items():
            if value is None or value == "":
                continue
            if isinstance(value, (list, tuple)):
                pairs.extend((key, str(item)) for item in value)
            else:
                pairs.append((key, str(value)))
        if not pairs:
            return url
        separator = "&" if "?" in url else "?"
        return f"{url}{separator}{urlencode(pairs)}"

    @staticmethod
    def _describe_status(status: int) -> str:
        """为状态码生成人类可读描述（与 TS 版措辞一致）。"""
        if status == 401:
            return "认证失败，访问令牌可能已失效或无权限"
        if status == 403:
            return "权限不足，当前令牌没有执行该操作的权限"
        if status == 404:
            return "资源不存在，或当前令牌无权访问"
        if status == 409:
            return "操作冲突，目标资源状态已变更"
        if status == 422:
            return "请求参数校验失败"
        if status == 429:
            return "请求过于频繁，已触发限流"
        return f"请求失败（HTTP {status}）"


def _parse_page_info(headers: Mapping[str, str]) -> PageInfo:
    """从响应头解析分页信息（Gitea 用 x-total-count 与 Link）。"""
    raw_total = headers.get("x-total-count")
    total: int | None = None
    if raw_total is not None:
        try:
            total = int(raw_total)
        except ValueError:
            total = None
    link = headers.get("link") or ""
    return PageInfo(total_count=total, has_next_page='rel="next"' in link)


__all__ = [
    "DEFAULT_MAX_RESPONSE_ITEMS",
    "DEFAULT_TIMEOUT_MS",
    "DEFAULT_USER_AGENT",
    "GiteaClient",
    "ListResult",
    "PageInfo",
]
