#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
# Run with: nix build ".#checks.$(nix eval --impure --raw --expr builtins.currentSystem).zvecGrepRuntime"

from __future__ import annotations

import ctypes
import json
import os
import socket
import subprocess
import sys
from collections.abc import Mapping
from contextlib import suppress
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from queue import Queue
from tempfile import TemporaryDirectory
from threading import Event, Thread
from typing import Final, TextIO, TypeAlias

Json: TypeAlias = "str | int | float | bool | None | list[Json] | Mapping[str, Json]"
FIXTURE: Final = "runtime-fixture.md"
MARKER: Final = "mothwing crescent"
MODEL: Final = "qwen3.7-text-embedding"
DIMENSIONS: Final = 1024
TOKEN: Final = "local-test-token"
TOOL: Final = "zvec_grep_search"


class Embeddings(HTTPServer):
    def __init__(self) -> None:
        super().__init__(("127.0.0.1", 0), EmbeddingHandler)
        self.used = Event()


class EmbeddingHandler(BaseHTTPRequestHandler):
    server: Embeddings

    def do_POST(self) -> None:
        request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if (
            self.path != "/v1/embeddings"
            or self.headers.get("Authorization") != f"Bearer {TOKEN}"
            or request.get("model") != MODEL
            or request.get("dimensions") != DIMENSIONS
            or not request.get("input")
        ):
            self.send_error(400, "Unexpected embedding request")
            return

        vector = [1.0] + [0.0] * (DIMENSIONS - 1)
        data = [
            {"index": index, "embedding": vector}
            for index, _ in enumerate(request["input"])
        ]
        response = json.dumps({"model": MODEL, "data": data}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)
        self.server.used.set()


def zg(binary: Path, *args: str) -> str:
    return subprocess.run(
        [str(binary), *args], check=True, text=True, stdout=subprocess.PIPE, timeout=45
    ).stdout


def check_index(binary: Path) -> None:
    with Embeddings() as server:
        worker = Thread(target=server.serve_forever)
        worker.start()
        try:
            zg(
                binary, "--index", "--mode", "direct",
                "--embedding", f"qwen/{MODEL}", "--api-key", TOKEN,
                "--endpoint", f"http://127.0.0.1:{server.server_port}/v1/embeddings",
            )
            assert server.used.is_set(), "Indexing never requested an embedding"
        finally:
            server.shutdown()
            worker.join()

    zg(binary, "--status", "--check-ready")
    result = zg(binary, "--mode", "direct", "--fts", MARKER)
    assert FIXTURE in result, result
    print("PASS local indexing, ready status, and FTS")


def read_mcp(stream: TextIO, responses: Queue[str]) -> None:
    for line in stream:
        responses.put(line)
    responses.put("")


def check_mcp(binary: Path, workspace: Path) -> None:
    with socket.socket() as port:
        port.bind(("127.0.0.1", 0))
        listen = f"127.0.0.1:{port.getsockname()[1]}"

    command = [str(binary), "--server", "--stdio", "--listen", listen]
    try:
        with subprocess.Popen(
            command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True
        ) as bridge:
            writer, reader = bridge.stdin, bridge.stdout
            assert writer is not None and reader is not None
            responses: Queue[str] = Queue()
            Thread(target=read_mcp, args=(reader, responses), daemon=True).start()

            def send(method: str, params: Mapping[str, Json], identifier: int | None = None) -> None:
                message = {"jsonrpc": "2.0", "method": method, "params": params}
                if identifier is not None:
                    message["id"] = identifier
                writer.write(json.dumps(message) + "\n")
                writer.flush()

            def request(identifier: int, method: str, params: Mapping[str, Json]) -> Mapping[str, Json]:
                send(method, params, identifier)
                line = responses.get(timeout=30)
                assert line, f"MCP bridge exited during {method}"
                reply = json.loads(line)
                assert reply["id"] == identifier and "result" in reply, reply
                return reply["result"]

            try:
                initial = request(1, "initialize", {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {},
                    "clientInfo": {"name": "coolheaded-runtime-check", "version": "1.0.0"},
                })
                assert initial["serverInfo"] and initial["protocolVersion"], initial
                send("notifications/initialized", {})
                tools = request(2, "tools/list", {})["tools"]
                assert isinstance(tools, list) and any(
                    isinstance(tool, Mapping) and tool.get("name") == TOOL for tool in tools
                ), tools
                result = request(3, "tools/call", {
                    "name": TOOL,
                    "arguments": {"root": str(workspace), "fts": [MARKER], "autoUpdate": False},
                })
                assert not result.get("isError") and FIXTURE in json.dumps(result), result
                print("PASS MCP initialize, tools/list, and indexed FTS tool call")
            finally:
                with suppress(BrokenPipeError):
                    writer.close()
                try:
                    bridge.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    bridge.kill()
                    bridge.wait()
    finally:
        zg(binary, "--server", "off")

    stopped = zg(binary, "--server", "status")
    assert "Server: stopped" in stopped, stopped
    print("PASS daemon shutdown")


def main() -> None:
    package = Path(sys.argv[1])
    binary = package / "bin/zg"
    onnx = "libonnxruntime.1.dylib" if sys.platform == "darwin" else "libonnxruntime.so.1"
    ctypes.CDLL(str(package / "lib" / onnx))
    print("PASS packaged ONNX Runtime library load")

    with TemporaryDirectory() as directory:
        root = Path(directory).resolve()
        for name in ("HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME",
                     "XDG_STATE_HOME", "ZVEC_GREP_HOME"):
            path = root / name.lower()
            path.mkdir()
            os.environ[name] = str(path)
        os.environ["NO_COLOR"] = "1"
        workspace = root / "workspace"
        workspace.mkdir()
        (workspace / FIXTURE).write_text(f"# Runtime fixture\n\n{MARKER}\n", encoding="utf-8")
        os.chdir(workspace)

        result = zg(binary, "--rg", MARKER)
        assert FIXTURE in result and MARKER in result, result
        print("PASS embedded ripgrep")
        check_index(binary)
        check_mcp(binary, workspace)


if __name__ == "__main__":
    main()
