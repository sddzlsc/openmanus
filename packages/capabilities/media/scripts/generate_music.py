#!/usr/bin/env python3
"""Generate a music track through a provider HTTP API (MUSIC_API_BASE + MUSIC_API_KEY)."""

from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _provider import download, poll, request_json, require_key  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成音乐")
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--out", default=os.environ.get("WIWANA_WORKSPACE", "/workspace"))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    api_key = require_key("MUSIC_API_KEY", "音乐生成需要商务开通的供应商 API Key（天工/海绵等）")
    base = os.environ.get("MUSIC_API_BASE", "").rstrip("/")
    if not base:
        raise SystemExit("[capability-error] 缺少 MUSIC_API_BASE（音乐供应商的接口地址）")
    os.makedirs(args.out, exist_ok=True)
    headers = {"Authorization": f"Bearer {api_key}"}

    created = request_json(f"{base}/generate", {"prompt": args.prompt}, headers)
    task_id = created.get("task_id") or created.get("data", {}).get("task_id")
    if not task_id:
        raise SystemExit(f"[capability-error] 未获得 task_id：{created}")
    print(f"created task {task_id}", flush=True)

    def poll_once() -> dict:
        import urllib.request

        request = urllib.request.Request(f"{base}/tasks/{task_id}", headers=headers)
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
        status = str(payload.get("status") or payload.get("data", {}).get("status", "")).lower()
        url = payload.get("audio_url") or payload.get("data", {}).get("audio_url")
        return {"done": status in {"succeeded", "success", "done"}, "status": status, "url": url, "raw": payload}

    final = poll(poll_once, interval=5, timeout=900, describe=lambda result: f"status={result.get('status')}")
    if not final.get("url"):
        raise SystemExit(f"[capability-error] 生成结果没有音频地址：{final.get('raw')}")
    target = os.path.join(args.out, "music.mp3")
    download(final["url"], target)
    print(f"saved {target}")


if __name__ == "__main__":
    main()
