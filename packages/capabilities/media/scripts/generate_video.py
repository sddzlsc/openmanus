#!/usr/bin/env python3
"""Generate a short video through a Kling-compatible API. Requires KELING_API_KEY."""

from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _provider import download, poll, request_json, require_key  # noqa: E402

BASE = os.environ.get("KELING_API_BASE", "https://api.klingai.com")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成视频")
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--out", default=os.environ.get("WIWANA_WORKSPACE", "/workspace"))
    parser.add_argument("--duration", default="5")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    api_key = require_key("KELING_API_KEY", "可灵视频生成需要 API Key（快手开放平台商务开通）")
    os.makedirs(args.out, exist_ok=True)
    headers = {"Authorization": f"Bearer {api_key}"}

    created = request_json(
        f"{BASE}/v1/videos/text2video",
        {"model_name": os.environ.get("KELING_MODEL", "kling-v1"), "prompt": args.prompt, "duration": args.duration},
        headers,
    )
    task_id = created.get("data", {}).get("task_id")
    if not task_id:
        raise SystemExit(f"[capability-error] 未获得 task_id：{created}")
    print(f"created task {task_id}", flush=True)

    def poll_once() -> dict:
        import urllib.request

        request = urllib.request.Request(f"{BASE}/v1/videos/text2video/{task_id}", headers=headers)
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
        status = str(payload.get("data", {}).get("task_status", "")).lower()
        videos = payload.get("data", {}).get("task_result", {}).get("videos") or []
        return {"done": status in {"succeed", "success"}, "status": status, "videos": videos, "raw": payload}

    final = poll(poll_once, interval=10, timeout=1800, describe=lambda result: f"status={result.get('status')}")
    target = os.path.join(args.out, "video.mp4")
    url = final["videos"][0].get("url") if final["videos"] else None
    if not url:
        raise SystemExit(f"[capability-error] 生成结果没有视频地址：{final.get('raw')}")
    download(url, target)
    print(f"saved {target}")


if __name__ == "__main__":
    main()
