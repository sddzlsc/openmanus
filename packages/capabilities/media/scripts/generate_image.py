#!/usr/bin/env python3
"""Generate an image through DashScope (通义万相). Requires DASHSCOPE_API_KEY."""

from __future__ import annotations

import argparse
import base64
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _provider import download, poll, request_json, require_key  # noqa: E402

CREATE_URL = os.environ.get(
    "DASHSCOPE_IMAGE_URL",
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
)
QUERY_URL = os.environ.get("DASHSCOPE_TASK_URL", "https://dashscope.aliyuncs.com/api/v1/tasks")
MODEL = os.environ.get("DASHSCOPE_IMAGE_MODEL", "wanx2.1-t2i-turbo")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成图片")
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--out", default=os.environ.get("WIWANA_WORKSPACE", "/workspace"))
    parser.add_argument("--size", default="1024*1024")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    api_key = require_key("DASHSCOPE_API_KEY", "通义万相图片生成需要 DashScope API Key（百炼控制台申请）")
    headers = {"Authorization": f"Bearer {api_key}", "X-DashScope-Async": "enable"}
    os.makedirs(args.out, exist_ok=True)

    created = request_json(
        CREATE_URL,
        {"model": MODEL, "input": {"prompt": args.prompt}, "parameters": {"size": args.size, "n": 1}},
        headers,
    )
    task_id = created.get("output", {}).get("task_id")
    if not task_id:
        raise SystemExit(f"[capability-error] 未获得 task_id：{created}")
    print(f"created task {task_id}", flush=True)

    def poll_once() -> dict:
        # DashScope 的任务查询使用 GET
        import json
        import urllib.request

        request = urllib.request.Request(f"{QUERY_URL}/{task_id}", headers={"Authorization": f"Bearer {api_key}"})
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
        status = payload.get("output", {}).get("task_status")
        results = payload.get("output", {}).get("results") or []
        return {"done": status == "SUCCEEDED", "status": status, "results": results, "raw": payload}

    final = poll(
        poll_once,
        interval=5,
        timeout=600,
        describe=lambda result: f"status={result.get('status')}",
    )
    target = os.path.join(args.out, "image.png")
    url = final["results"][0].get("url")
    if not url:
        raise SystemExit(f"[capability-error] 生成结果没有图片地址：{final.get('raw')}")
    download(url, target)
    print(f"saved {target}")


if __name__ == "__main__":
    main()
