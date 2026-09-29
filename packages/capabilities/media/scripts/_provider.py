"""Shared HTTP helpers for media providers (stdlib only)."""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request


def require_key(name: str, hint: str) -> str:
    value = os.environ.get(name)
    if not value:
        print(f"[capability-error] 缺少环境变量 {name}：{hint}", file=sys.stderr)
        raise SystemExit(3)
    return value


def request_json(url: str, payload: dict, headers: dict, timeout: int = 60) -> dict:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers={**headers, "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:  # noqa: PERF203
        detail = error.read().decode("utf-8", "ignore")[:400]
        raise SystemExit(f"[capability-error] HTTP {error.code}: {detail}") from error


def download(url: str, target: str, headers: dict | None = None, timeout: int = 300) -> str:
    request = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(request, timeout=timeout) as response, open(target, "wb") as handle:
        while True:
            chunk = response.read(1024 * 256)
            if not chunk:
                break
            handle.write(chunk)
    return target


def poll(fn, *, interval: float = 5.0, timeout: float = 900.0, describe=None) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        result = fn()
        if describe:
            print(describe(result), flush=True)
        if result.get("done"):
            return result
        time.sleep(interval)
    raise SystemExit("[capability-error] 生成任务超时（可在任务详情重试）")
