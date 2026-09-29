#!/usr/bin/env python3
"""Headless browser operations for the Wiwana sandbox (Manus Browser Operator equivalent).

Actions: text | links | title | screenshot | click | fill
Screenshots are written to the workspace so they are registered as deliverables.
"""

from __future__ import annotations

import argparse
import json
import os
import sys


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="无头浏览器操作")
    parser.add_argument("--url", required=True)
    parser.add_argument("--action", default="text", choices=["text", "links", "title", "screenshot", "click", "fill"])
    parser.add_argument("--selector", default=None)
    parser.add_argument("--value", default=None)
    parser.add_argument("--submit", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--wait", type=float, default=1.0, help="等待网络空闲的秒数")
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--out", default=os.environ.get("WIWANA_WORKSPACE", "/workspace"))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("浏览器能力不可用：playwright 未安装", file=sys.stderr)
        raise SystemExit(3)

    os.makedirs(args.out, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        context = browser.new_context(locale="zh-CN", viewport={"width": 1440, "height": 900})
        page = context.new_page()
        page.set_default_timeout(args.timeout * 1000)
        page.goto(args.url, wait_until="domcontentloaded", timeout=args.timeout * 1000)
        page.wait_for_timeout(args.wait * 1000)

        if args.action == "screenshot":
            name = args.selector or "page"
            path = os.path.join(args.out, f"browser-{name.strip('#./')[:40] or 'page'}.png")
            page.screenshot(path=path, full_page=True)
            print(f"saved {path}")
        elif args.action == "links":
            links = page.eval_on_selector_all(
                "a[href]", "els => els.map(e => ({ text: (e.innerText || '').trim().slice(0, 80), href: e.href }))"
            )
            print(json.dumps(links[:200], ensure_ascii=False, indent=2) if args.json else "\n".join(f"{l['text']}\t{l['href']}" for l in links[:200]))
        elif args.action == "title":
            print(page.title())
        elif args.action == "click":
            if not args.selector:
                raise SystemExit("--action click 需要 --selector")
            page.click(args.selector)
            page.wait_for_timeout(args.wait * 1000)
            print(page.inner_text("body")[:4000])
        elif args.action == "fill":
            if not (args.selector and args.value is not None):
                raise SystemExit("--action fill 需要 --selector 与 --value")
            page.fill(args.selector, args.value)
            if args.submit:
                page.keyboard.press("Enter")
                page.wait_for_timeout(args.wait * 1000)
            print(page.inner_text("body")[:4000])
        else:
            print(page.inner_text("body")[:12000])

        context.close()
        browser.close()


if __name__ == "__main__":
    main()
