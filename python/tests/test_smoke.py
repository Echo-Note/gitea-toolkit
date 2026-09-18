"""冒烟测试：离线可跑，不依赖任何真实 Gitea 实例。

覆盖三处最容易出错、又最不需要网络的地方：

1. URL 拼装（数组参数要展开成同名重复参数、空值要跳过）—— Gitea 的 array 类型查询参数约定；
2. git 远端解析（SSH 与 HTTP(S) 两种形式，取最后两段作为 owner/repo）；
3. 服务装配（工具确实注册上了、且只读/写标注正确）—— 用 SDK 的内存 Client 真握手。

用 ``unittest`` 而非 pytest：本包刻意保持"零测试依赖"，CI 里 `python -m unittest` 即可。
"""

from __future__ import annotations

import asyncio
import unittest

from mcp import Client

from gitea_toolkit_mcp.client import GiteaClient
from gitea_toolkit_mcp.repo_ref import parse_remote_url
from gitea_toolkit_mcp.server import ServerConfig, build_server

#: 目前实现的工具（随各域补齐而增长；与 TS 版的 toolReferenceName 同名）
EXPECTED_TOOLS = {
    "gitea_list_repos",
    "gitea_get_repo",
    "gitea_create_repo",
    "gitea_list_branches",
    "gitea_create_branch",
    "gitea_list_commits",
    "gitea_list_files",
    "gitea_get_file",
    "gitea_get_commit_status",
    "gitea_commit_file",
    "gitea_get_current_user",
    "gitea_list_orgs",
}

#: 这些必须被标注为「只读」—— 标错会让客户端以为写操作是安全的
READ_ONLY_TOOLS = EXPECTED_TOOLS - {
    "gitea_create_repo",
    "gitea_create_branch",
    "gitea_commit_file",
}


class TestBuildUrl(unittest.TestCase):
    """URL 拼装。"""

    def setUp(self) -> None:
        self.client = GiteaClient("https://gitea.example.com/")

    def test_normalizes_server_url(self) -> None:
        self.assertEqual(self.client.server_url, "https://gitea.example.com")
        self.assertEqual(self.client.has_token, False)

    def test_expands_array_query_as_repeated_params(self) -> None:
        url = self.client._build_url("/repos/issues/search", {"labels": ["bug", "ui"], "limit": 50})
        # Gitea 约定：数组参数用同名重复参数，而不是逗号拼接
        self.assertIn("labels=bug&labels=ui", url)
        self.assertIn("limit=50", url)

    def test_skips_empty_values(self) -> None:
        url = self.client._build_url("/repos/search", {"q": "", "owner": None, "page": 1})
        self.assertNotIn("q=", url)
        self.assertNotIn("owner=", url)
        self.assertIn("page=1", url)

    def test_rejects_missing_or_invalid_server_url(self) -> None:
        from gitea_toolkit_mcp.errors import GiteaConfigError

        with self.assertRaises(GiteaConfigError):
            GiteaClient("")
        with self.assertRaises(GiteaConfigError):
            GiteaClient("gitea.example.com")  # 缺 scheme


class TestParseRemoteUrl(unittest.TestCase):
    """git 远端解析。"""

    def test_ssh_scp_form(self) -> None:
        ref = parse_remote_url("git@gitea.example.com:acme/widgets.git")
        self.assertEqual((ref.owner, ref.repo), ("acme", "widgets"))

    def test_https_form(self) -> None:
        ref = parse_remote_url("https://gitea.example.com/acme/widgets.git")
        self.assertEqual((ref.owner, ref.repo), ("acme", "widgets"))

    def test_ssh_url_form_without_git_suffix(self) -> None:
        ref = parse_remote_url("ssh://git@gitea.example.com/acme/widgets")
        self.assertEqual((ref.owner, ref.repo), ("acme", "widgets"))

    def test_takes_last_two_segments(self) -> None:
        # 多级路径（非 Gitea 常见，但不应崩）取最后两段
        ref = parse_remote_url("https://gitlab.example.com/group/sub/widgets.git")
        self.assertEqual((ref.owner, ref.repo), ("sub", "widgets"))

    def test_returns_none_for_garbage(self) -> None:
        self.assertIsNone(parse_remote_url(""))
        self.assertIsNone(parse_remote_url("just-a-name"))


class TestServerAssembly(unittest.TestCase):
    """服务装配：用内存 Client 真握手，确认工具注册与只读标注。"""

    @staticmethod
    async def _tools(client: Client) -> list:
        """取工具列表。

        v2 的 ``Client.list_tools()`` 返回 ``ListToolsResult``（pydantic 模型）。
        注意**不能直接迭代它** —— pydantic 模型迭代出来的是 ``(字段名, 值)`` 元组，
        会得到 ``'tuple' object has no attribute 'name'`` 这种莫名其妙的报错（实测踩过）。
        """
        result = await client.list_tools()
        return list(getattr(result, "tools", result))

    def test_registers_expected_tools_with_annotations(self) -> None:
        server = build_server(ServerConfig(server_url="https://gitea.example.com", token="dummy"))

        async def inspect() -> dict[str, bool]:
            async with Client(server) as client:
                return {
                    tool.name: bool(getattr(tool.annotations, "read_only_hint", False))
                    for tool in await self._tools(client)
                }

        actual = asyncio.run(inspect())
        self.assertEqual(set(actual), EXPECTED_TOOLS, "注册的工具集与预期不一致")
        for name in READ_ONLY_TOOLS:
            self.assertTrue(actual[name], f"{name} 应标注为只读")
        for name in EXPECTED_TOOLS - READ_ONLY_TOOLS:
            self.assertFalse(actual[name], f"{name} 涉及写操作，不应标注为只读")

    def test_tool_schema_keeps_ts_style_parameter_names(self) -> None:
        """参数名要与 TS 版一致（camelCase），否则两个实现无法互换。"""
        server = build_server(ServerConfig(server_url="https://gitea.example.com"))

        async def schema(name: str) -> dict:
            async with Client(server) as client:
                tools = await self._tools(client)
                return next(t for t in tools if t.name == name).input_schema

        props = asyncio.run(schema("gitea_create_repo"))["properties"]
        self.assertIn("autoInit", props)
        self.assertIn("defaultBranch", props)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
