"""服务装配：把配置、客户端与全部工具组装成一个 MCPServer。"""

from __future__ import annotations

from dataclasses import dataclass

from . import __version__
from .client import DEFAULT_TIMEOUT_MS, GiteaClient
from .tools import register_all
from .tools._shared import ToolContext, set_context

#: MCP 服务在客户端里显示的名字
SERVER_NAME = "gitea-toolkit"

#: 服务说明（会展示给模型，帮助它判断何时使用这些工具）
SERVER_INSTRUCTIONS = (
    "Gitea 仓库协作工具：浏览仓库与文件、检索提交、读写 Issue 与 Pull Request、"
    "查看与触发 Gitea Actions、处理通知。多数工具无需显式传 owner/repo —— "
    "在 Gitea 仓库目录下启动时会自动读取 origin 远端；写操作会真实改动远端数据。"
    # 明确要求转达：否则模型很可能只把兼容性提示当成背景信息，用户永远看不到
    "首次调用工具时会自动检查服务端 Gitea 版本；若返回以 ⚠️ 开头提示版本不兼容，"
    "请把该提示如实转达给用户。"
)


@dataclass
class ServerConfig:
    """运行期配置（命令行 > 环境变量 > 默认值）。"""

    server_url: str
    token: str | None = None
    verify_tls: bool = True
    timeout_ms: int = DEFAULT_TIMEOUT_MS
    max_output_length: int = 100_000


def build_server(config: ServerConfig):
    """构造 MCPServer 并注册全部工具。

    Args:
        config: 运行期配置

    Returns:
        可直接 ``.run(transport="stdio")`` 的 MCPServer 实例
    """
    from mcp.server.mcpserver import MCPServer

    client = GiteaClient(
        config.server_url,
        token=config.token,
        verify_tls=config.verify_tls,
        timeout_ms=config.timeout_ms,
    )
    set_context(
        ToolContext(
            client=client,
            server_url=client.server_url,
            max_output_length=config.max_output_length,
        )
    )

    server = MCPServer(
        name=SERVER_NAME,
        title="Gitea Toolkit",
        instructions=SERVER_INSTRUCTIONS,
        # v2 不传 version 会上报空字符串，客户端里会显示成未知版本
        version=__version__,
    )
    register_all(server)
    return server
