"""命令行入口。

与 TS 版 `src/mcpServer/main.ts` 的参数、环境变量、优先级保持一致：

- 参数：``--url`` ``--token`` ``--no-verify-tls`` ``--timeout`` ``--max-output``
  ``-h/--help`` ``-v/--version``
- 环境变量：``GITEA_SERVER_URL`` ``GITEA_TOKEN`` ``GITEA_VERIFY_TLS``
  ``GITEA_TIMEOUT_MS`` ``GITEA_MAX_OUTPUT_LENGTH``
- 优先级：命令行 > 环境变量 > 默认值

**stdout 只能出现 MCP 协议报文**，所以除 ``--help`` / ``--version`` 外一切输出都走 stderr。
"""

from __future__ import annotations

import argparse
import os
import sys

from . import __version__
from .client import DEFAULT_TIMEOUT_MS
from .server import ServerConfig, build_server

USAGE = """gitea-toolkit-mcp —— Gitea 仓库 / Issue / PR / 通知 / 工作流 的 MCP 工具服务（stdio）

用法：
  gitea-toolkit-mcp [选项]

选项（均可用环境变量提供，命令行参数优先）：
  --url <地址>         Gitea 实例地址              [环境变量 GITEA_SERVER_URL]
  --token <令牌>       访问令牌                    [环境变量 GITEA_TOKEN]
  --no-verify-tls      跳过 HTTPS 证书校验          [环境变量 GITEA_VERIFY_TLS=false]
  --timeout <毫秒>     请求超时，默认 20000        [环境变量 GITEA_TIMEOUT_MS]
  --max-output <字符>  单次工具输出上限，默认 100000 [环境变量 GITEA_MAX_OUTPUT_LENGTH]
  -h, --help           显示本帮助
  -v, --version        显示版本号

示例：
  uvx gitea-toolkit-mcp --url https://gitea.example.com --token <你的令牌>

MCP 客户端配置示例（Claude Desktop / Cursor 等）：
  {
    "mcpServers": {
      "gitea": {
        "command": "uvx",
        "args": ["gitea-toolkit-mcp", "--url", "https://gitea.example.com", "--token", "<令牌>"]
      }
    }
  }

令牌需在 Gitea 的「设置 → 应用 → 生成令牌」创建，勾选 repo、issue、notification 权限。"""


def _log(message: str) -> None:
    """诊断信息一律走 stderr —— stdout 归 MCP 协议所有。"""
    sys.stderr.write(f"[gitea-toolkit-mcp] {message}\n")
    sys.stderr.flush()


class _Parser(argparse.ArgumentParser):
    """让 --help / 参数错误的输出也遵守「stdout 归协议」的约定。

    argparse 默认把 help 写 stdout、错误写 stderr；这里显式固定：用户主动要 help 时
    写 stdout（那是显式命令），参数写错时写 stderr 并以退出码 2 结束。
    """

    def error(self, message: str):  # type: ignore[override]
        sys.stderr.write(f"{USAGE}\n\n错误：{message}\n")
        raise SystemExit(2)


def build_parser() -> argparse.ArgumentParser:
    """构造参数解析器。"""
    parser = _Parser(
        prog="gitea-toolkit-mcp",
        description="Gitea 的 MCP 工具服务（stdio 传输）",
        add_help=False,
    )
    parser.add_argument("--url", dest="url", default=None, help="Gitea 实例地址")
    parser.add_argument("--token", dest="token", default=None, help="Gitea 访问令牌")
    parser.add_argument("--no-verify-tls", dest="no_verify_tls", action="store_true", help="跳过证书校验")
    parser.add_argument("--timeout", dest="timeout", type=int, default=None, help="请求超时（毫秒）")
    parser.add_argument("--max-output", dest="max_output", type=int, default=None, help="单次工具输出上限（字符）")
    parser.add_argument("-h", "--help", action="help", help="显示本帮助")
    parser.add_argument("-v", "--version", action="version", version=f"gitea-toolkit-mcp {__version__}")
    return parser


def _env_flag_false(name: str) -> bool:
    """环境变量显式设为 false 时返回 True（与 TS 版一致的判据）。"""
    return (os.environ.get(name, "true") or "true").strip().lower() == "false"


def _env_int(name: str) -> int | None:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return None
    try:
        value = int(raw)
    except ValueError:
        return None
    return value if value > 0 else None


def resolve_config(args: argparse.Namespace) -> ServerConfig:
    """合并命令行与环境变量（命令行优先）。"""
    url = (args.url or os.environ.get("GITEA_SERVER_URL") or "").strip().rstrip("/")
    token = (args.token or os.environ.get("GITEA_TOKEN") or "").strip() or None

    if args.no_verify_tls:
        verify_tls = False
    else:
        verify_tls = not _env_flag_false("GITEA_VERIFY_TLS")

    timeout_ms = args.timeout or _env_int("GITEA_TIMEOUT_MS") or DEFAULT_TIMEOUT_MS
    max_output = args.max_output or _env_int("GITEA_MAX_OUTPUT_LENGTH") or 100_000

    if not url:
        sys.stderr.write(
            f"{USAGE}\n\n错误：未配置 Gitea 实例地址。请传 --url，或设置环境变量 GITEA_SERVER_URL。\n"
        )
        raise SystemExit(2)

    return ServerConfig(
        server_url=url,
        token=token,
        verify_tls=verify_tls,
        timeout_ms=timeout_ms,
        max_output_length=max_output,
    )


def main(argv: list[str] | None = None) -> None:
    """进程入口。"""
    args = build_parser().parse_args(argv)
    config = resolve_config(args)
    server = build_server(config)
    _log(
        f"已启动；实例 {config.server_url}；"
        f"令牌 {'已配置' if config.token else '未配置（只能读公开内容）'}；"
        f"证书校验 {'关闭' if not config.verify_tls else '开启'}"
    )
    server.run(transport="stdio")


if __name__ == "__main__":  # pragma: no cover
    main()
