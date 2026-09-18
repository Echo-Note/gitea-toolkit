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

#: 全部工具（与 TS 版的 toolReferenceName 一一对应）
#:
#: 这里刻意**逐个列全**而不是断言数量：数量相同但名字错了的漂移，
#: 用数量是查不出来的 —— 而「两个实现工具名一致」正是可互换的前提。
EXPECTED_TOOLS = {
    # 仓库域
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
    # Issue 域
    "gitea_list_issues",
    "gitea_get_issue",
    "gitea_create_issue",
    "gitea_update_issue",
    "gitea_comment_issue",
    "gitea_list_issue_comments",
    # PR 域
    "gitea_list_pulls",
    "gitea_get_pull",
    "gitea_get_pull_diff",
    "gitea_list_pull_files",
    "gitea_create_pull",
    "gitea_merge_pull",
    "gitea_review_pull",
    # 账户 / 通知域
    "gitea_get_current_user",
    "gitea_list_orgs",
    "gitea_list_notifications",
    "gitea_mark_notifications_read",
    # Actions 域
    "gitea_list_workflows",
    "gitea_list_action_runs",
    "gitea_get_action_run",
    "gitea_get_job_logs",
    "gitea_list_artifacts",
    "gitea_dispatch_workflow",
    "gitea_rerun_action",
    "gitea_set_workflow_enabled",
}

#: 只**新增**内容、不动既有数据的写工具 → ``destructiveHint`` 必须为 false。
#:
#: 规范里 ``destructiveHint=false`` 的含义就是「仅做增量更新」。若把「创建 Issue」
#: 也标成破坏性，客户端会在每次调用前弹确认框 —— 用户很快就会被训练成无脑点「同意」，
#: 真正危险的操作反而失去了警示作用。
ADDITIVE_WRITE_TOOLS = {
    "gitea_create_repo",
    "gitea_create_branch",
    "gitea_create_issue",
    "gitea_comment_issue",
    "gitea_create_pull",
    "gitea_review_pull",
    "gitea_dispatch_workflow",
    "gitea_rerun_action",
    # 幂等写（标记已读）也只改状态、不删内容
    "gitea_mark_notifications_read",
}

#: 会**覆盖或删除既有内容**的写工具 → ``destructiveHint`` 必须为 true
DESTRUCTIVE_WRITE_TOOLS = {
    "gitea_update_issue",  # 覆盖标题 / 正文，可直接关闭
    "gitea_commit_file",  # 覆盖文件内容
    "gitea_merge_pull",  # 不可逆地合并、关闭 PR
    "gitea_set_workflow_enabled",  # 改变 CI 行为（静默停掉工作流很危险）
}

#: 会真实改动远端数据的工具 —— 它们**不能**标注成只读，否则客户端会以为可以随意调用
WRITE_TOOLS = ADDITIVE_WRITE_TOOLS | DESTRUCTIVE_WRITE_TOOLS

#: 这些必须被标注为「只读」
READ_ONLY_TOOLS = EXPECTED_TOOLS - WRITE_TOOLS

#: 必填参数清单（与 TS 版 ``inputShape`` 里**没写** ``.optional()`` 的字段一一对应）。
#:
#: 断言写成「逐字相等」而不是「包含」：schema 里少一个 required，模型就得多猜一轮；
#: 多一个 required，客户端会在参数校验阶段就拒掉合法调用。两个方向都是 bug。
REQUIRED_PARAMS = {
    "gitea_create_repo": {"name"},
    "gitea_create_branch": {"newBranch"},
    "gitea_get_file": {"filePath"},
    "gitea_commit_file": {"filePath", "content"},
    "gitea_get_commit_status": {"ref"},
    "gitea_get_issue": {"index"},
    "gitea_create_issue": {"title"},
    "gitea_update_issue": {"index"},
    "gitea_comment_issue": {"index", "body"},
    "gitea_list_issue_comments": {"index"},
    "gitea_get_pull": {"index"},
    "gitea_get_pull_diff": {"index"},
    "gitea_list_pull_files": {"index"},
    "gitea_create_pull": {"title", "head", "base"},
    "gitea_merge_pull": {"index"},
    "gitea_review_pull": {"index", "event"},
    "gitea_get_action_run": {"run_id"},
    "gitea_get_job_logs": {"job_id"},
    "gitea_dispatch_workflow": {"workflow_id", "ref"},
    "gitea_rerun_action": {"run_id"},
    "gitea_set_workflow_enabled": {"workflow_id", "enabled"},
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

    def test_default_user_agent_is_not_blocked_by_proxies(self) -> None:
        """默认 UA 必须与 TS 版一致，且**不含 ``python``**。

        这条不是洁癖：实测实例的前置 nginx 按 UA 关键字拦截，UA 里出现 ``python``
        （或干脆不发 UA）会直接返回 403 Forbidden —— 那个 403 长得像权限问题，
        但实际跟令牌无关，排查时极容易被带偏（本项目真踩过）。
        """
        from gitea_toolkit_mcp.client import DEFAULT_USER_AGENT

        self.assertEqual(DEFAULT_USER_AGENT, "gitea-toolkit-mcp")
        self.assertNotIn("python", DEFAULT_USER_AGENT.lower())
        self.assertTrue(DEFAULT_USER_AGENT.strip())


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
        for name in WRITE_TOOLS:
            self.assertFalse(actual[name], f"{name} 涉及写操作，不应标注为只读")

    def _schemas(self) -> dict[str, dict]:
        """一次握手取回全部工具的 inputSchema / title / annotations。"""
        server = build_server(ServerConfig(server_url="https://gitea.example.com", token="dummy"))

        async def collect() -> dict[str, dict]:
            async with Client(server) as client:
                return {
                    tool.name: {
                        "schema": tool.input_schema or {},
                        "title": getattr(tool, "title", None),
                        "annotations": tool.annotations,
                    }
                    for tool in await self._tools(client)
                }

        return asyncio.run(collect())

    def test_every_tool_has_human_readable_title(self) -> None:
        """每个工具都要有 ``title``（与 TS 版 ``displayName`` 一致）。

        规范把它列为可选字段，但客户端的授权确认窗、工具列表更常显示 title；
        TS 版两个位置（``tool.title`` 与 ``annotations.title``）都写了，
        所以这里按「必须有」来守 —— 漏一个就是两个实现的展示不一致。
        """
        collected = self._schemas()
        for name, entry in collected.items():
            with self.subTest(tool=name):
                self.assertTrue(entry["title"], f"{name} 缺少 title")
                self.assertEqual(
                    getattr(entry["annotations"], "title", None),
                    entry["title"],
                    f"{name} 的 annotations.title 与 tool.title 不一致",
                )

    def test_required_params_are_declared_in_schema(self) -> None:
        """必填参数必须体现在 ``inputSchema.required`` 里。

        绝不能写成 ``index: int = 0`` 再用运行时 ``raise`` 兜 —— 那样 schema 会宣称
        「什么都可以不传」，模型只能靠猜；而且真正的报错要等一次往返之后才拿得到。
        """
        schemas = {name: entry["schema"] for name, entry in self._schemas().items()}
        for name in EXPECTED_TOOLS:
            expected = REQUIRED_PARAMS.get(name, set())
            actual = set(schemas[name].get("required") or [])
            with self.subTest(tool=name):
                self.assertEqual(
                    actual,
                    expected,
                    f"{name} 的 required 与预期不一致（schema 说可选的参数，模型就会真的不传）",
                )

    def test_destructive_hint_matches_what_the_tool_actually_does(self) -> None:
        """``destructiveHint`` 要如实反映行为：增量写 false，覆盖 / 删除 true。"""
        collected = self._schemas()
        for name in ADDITIVE_WRITE_TOOLS:
            with self.subTest(tool=name):
                self.assertFalse(
                    getattr(collected[name]["annotations"], "destructive_hint", False),
                    f"{name} 只新增内容，不应标为破坏性（否则每次都弹确认框）",
                )
        for name in DESTRUCTIVE_WRITE_TOOLS:
            with self.subTest(tool=name):
                self.assertTrue(
                    getattr(collected[name]["annotations"], "destructive_hint", False),
                    f"{name} 会覆盖 / 删除既有内容，必须标为破坏性",
                )

    def test_tool_errors_reach_the_model(self) -> None:
        """工具内的报错必须真的传到模型手里（而不是被 SDK 换成一句固定英文）。

        MCP Python SDK v2 对「非 ToolError 的异常」一律替换成 ``Error executing tool <名字>``，
        原始文案刻意不外泄。所以工具层必须把异常包成 ``ToolError``——否则我们写的中文原因
        （「权限不足」「无法确定 owner」）一个字都到不了模型，模型也就无法自我纠正。
        """
        server = build_server(ServerConfig(server_url="https://gitea.example.com", token="dummy"))

        async def call() -> tuple[bool, str]:
            async with Client(server) as client:
                # 只给 repo、不给 owner，且工作目录推断不出仓库 → 走我们的中文报错分支
                result = await client.call_tool("gitea_list_issues", {"repo": "only-a-repo-name"})
                dumped = result.model_dump(by_alias=True, exclude_none=True)
                text = "\n".join(
                    block.get("text", "") for block in (dumped.get("content") or [])
                )
                return bool(dumped.get("isError")), text

        is_error, text = asyncio.run(call())
        self.assertTrue(is_error, "缺仓库坐标应以 isError 结果返回")
        self.assertIn("无法确定 owner", text, "我们的中文原因被 SDK 吞掉了")

    def test_tool_schema_keeps_ts_style_parameter_names(self) -> None:
        """参数名要与 TS 版一致（camelCase 与 snake_case 都按 TS 的写法），否则两个实现无法互换。"""
        server = build_server(ServerConfig(server_url="https://gitea.example.com"))

        async def schema(name: str) -> dict:
            async with Client(server) as client:
                tools = await self._tools(client)
                return next(t for t in tools if t.name == name).input_schema

        # 逐个域抽查容易写错的那几个：camelCase 的、以及 snake_case 的（TS 版对
        # Actions 的参数用的是 snake_case，跟着它走才不会在两边产生分歧）
        cases = {
            "gitea_create_repo": ["autoInit", "defaultBranch"],
            "gitea_list_issues": ["assignedToMe", "createdByMe", "mentionedMe"],
            "gitea_create_issue": ["assignees", "labels"],
            "gitea_merge_pull": ["deleteBranchAfterMerge", "mergeTitle", "mergeMessage"],
            "gitea_list_notifications": ["includeRead", "subjectTypes"],
            "gitea_mark_notifications_read": ["all", "lastReadAt"],
            "gitea_get_action_run": ["run_id"],
            "gitea_get_job_logs": ["job_id", "tail_lines"],
            "gitea_dispatch_workflow": ["workflow_id", "ref", "inputs"],
            "gitea_rerun_action": ["run_id", "failed_only"],
        }
        for tool_name, expected in cases.items():
            props = asyncio.run(schema(tool_name))["properties"]
            for param in expected:
                self.assertIn(param, props, f"{tool_name} 缺少参数 {param}")


class TestFormatting(unittest.TestCase):
    """返回文本的格式化（纯函数，离线可测）。

    这些文本是**模型唯一能看到的东西**，所以值得钉住：错一处就会让模型判断失准。
    例如「跨仓库检索没带仓库名」，模型就无法知道该去哪个仓库跟进。
    """

    def test_issue_line_includes_repo_only_for_cross_repo_search(self) -> None:
        from gitea_toolkit_mcp.tools._format import format_issue_line

        base = {
            "number": 7,
            "title": "修一下",
            "state": "open",
            "user": {"login": "alice"},
        }
        single = format_issue_line(dict(base))
        self.assertNotIn("acme/widgets", single)

        cross = format_issue_line(
            {**base, "repository": {"full_name": "acme/widgets"}}
        )
        self.assertIn("acme/widgets", cross, "跨仓库检索必须标注仓库名")

    def test_action_state_label_distinguishes_completed_from_success(self) -> None:
        from gitea_toolkit_mcp.tools._format import action_state_label

        # 关键：Gitea 的 status=completed 只代表「跑完了」，成功与否看 conclusion。
        # 若把 completed 直接当成「成功」，模型会把失败的 CI 报成通过。
        self.assertEqual(action_state_label("completed", "success"), "成功")
        self.assertEqual(action_state_label("completed", "failure"), "失败")
        self.assertEqual(action_state_label("completed", None), "已完成")
        self.assertEqual(action_state_label("waiting", None), "等待中")
        self.assertEqual(action_state_label("某个新状态", None), "某个新状态")

    def test_format_bytes(self) -> None:
        from gitea_toolkit_mcp.tools._format import format_bytes

        self.assertEqual(format_bytes(0), "0 B")
        self.assertEqual(format_bytes(1023), "1023 B")
        self.assertEqual(format_bytes(2048), "2.0 KB")
        self.assertEqual(format_bytes(5 * 1024 * 1024), "5.0 MB")
        self.assertEqual(format_bytes(None), "未知大小")

    def test_tail_lines_keeps_the_end(self) -> None:
        from gitea_toolkit_mcp.tools._format import tail_lines

        text = "\n".join(f"line-{i}" for i in range(1, 11))
        kept, truncated = tail_lines(text, 3)
        self.assertTrue(truncated)
        self.assertEqual(kept.splitlines(), ["line-8", "line-9", "line-10"])

        same, truncated_short = tail_lines("a\nb", 10)
        self.assertFalse(truncated_short)
        self.assertEqual(same, "a\nb")

    def test_truncate_says_how_much_was_dropped(self) -> None:
        from gitea_toolkit_mcp.tools._format import truncate

        self.assertEqual(truncate("abc", 10), "abc")
        clipped = truncate("x" * 100, 10)
        self.assertTrue(clipped.startswith("x" * 10))
        self.assertIn("共 100 字符", clipped, "截断要说明原始长度，不能静默丢内容")


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
