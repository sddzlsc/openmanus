#!/usr/bin/env python3
"""Ask a domestic multimodal model (Qwen-VL on DashScope) about one or more images.

Used for visual self-checks of generated pages/decks and for understanding images
the user uploads. OpenAI-compatible endpoint, stdlib only.
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import sys
import urllib.error
import urllib.request

DEFAULT_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
DEFAULT_MODEL = "qwen-vl-max"
DEFAULT_PROMPT = (
    "请描述这张图片的内容；如果是界面截图，指出排版问题"
    "（文字是否超出色块、元素是否重叠、对比度是否不足），按严重程度排序。"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="用 Qwen-VL 理解图片/截图")
    parser.add_argument("--image", action="append", required=True, help="图片路径或 URL，可重复")
    parser.add_argument("--prompt", default=DEFAULT_PROMPT)
    parser.add_argument("--model", default=os.environ.get("VISION_MODEL", DEFAULT_MODEL))
    parser.add_argument("--out", default=None, help="把回答写入文件（会成为交付物）")
    parser.add_argument("--json", action="store_true", help="以 JSON 输出完整响应")
    parser.add_argument("--max-tokens", type=int, default=1500)
    return parser.parse_args()


def as_image_url(value: str) -> str:
    if value.startswith(("http://", "https://", "data:")):
        return value
    if not os.path.isfile(value):
        raise SystemExit(f"[capability-error] 找不到图片：{value}")
    mime = mimetypes.guess_type(value)[0] or "image/png"
    with open(value, "rb") as handle:
        encoded = base64.b64encode(handle.read()).decode()
    return f"data:{mime};base64,{encoded}"


def main() -> None:
    args = parse_args()
    api_key = os.environ.get("DASHSCOPE_API_KEY")
    if not api_key:
        print(
            "[capability-error] 缺少 DASHSCOPE_API_KEY：视觉理解需要阿里云百炼密钥（控制面已透传给沙箱）",
            file=sys.stderr,
        )
        raise SystemExit(3)

    content: list[dict] = [{"type": "text", "text": args.prompt}]
    for image in args.image:
        content.append({"type": "image_url", "image_url": {"url": as_image_url(image)}})

    payload = {
        "model": args.model,
        "messages": [{"role": "user", "content": content}],
        "max_tokens": args.max_tokens,
    }
    request = urllib.request.Request(
        os.environ.get("DASHSCOPE_COMPATIBLE_URL", DEFAULT_ENDPOINT),
        data=json.dumps(payload).encode(),
        headers={"content-type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            body = json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "ignore")[:400]
        print(f"[capability-error] HTTP {error.code}: {detail}", file=sys.stderr)
        raise SystemExit(1) from error

    answer = (body.get("choices") or [{}])[0].get("message", {}).get("content", "")
    if isinstance(answer, list):  # some models return content blocks
        answer = "".join(part.get("text", "") for part in answer if isinstance(part, dict))
    answer = str(answer).strip()

    if args.json:
        print(json.dumps(body, ensure_ascii=False, indent=2))
    else:
        print(answer)
    if args.out and answer:
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(f"# 视觉自检报告\n\n模型：{args.model}\n\n{answer}\n")
        print(f"\nsaved {args.out}")


if __name__ == "__main__":
    main()
