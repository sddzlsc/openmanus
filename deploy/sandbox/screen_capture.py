#!/usr/bin/env python3
"""Capture the project preview page for the live "computer view".

Called by the runtime agent on a timer while a task runs. Prints `ok <path>` on
success and `skip <reason>` when there is nothing to show yet (no preview page,
navigation error) — the agent treats `skip` as "do not emit a frame".
"""

from __future__ import annotations

import argparse
import os
import sys


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="截取预览页面")
    parser.add_argument("--url", default="http://127.0.0.1:5173/index.html")
    parser.add_argument("--out", default="/tmp/wiwana-screen.jpg")
    parser.add_argument("--width", type=int, default=960)
    parser.add_argument("--height", type=int, default=600)
    parser.add_argument("--quality", type=int, default=55)
    parser.add_argument("--timeout", type=float, default=15.0)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("skip playwright 未安装")
        return

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
            page = browser.new_page(viewport={"width": args.width, "height": args.height})
            response = page.goto(args.url, wait_until="domcontentloaded", timeout=args.timeout * 1000)
            if response is None or response.status >= 400:
                browser.close()
                print("skip 预览页还不存在")
                return
            page.wait_for_timeout(600)
            os.makedirs(os.path.dirname(args.out), exist_ok=True)
            page.screenshot(path=args.out, type="jpeg", quality=args.quality)
            browser.close()
        print(f"ok {args.out}")
    except Exception as error:  # noqa: BLE001 - any failure means "no frame yet"
        print(f"skip {type(error).__name__}: {str(error)[:120]}")
        sys.exit(0)


if __name__ == "__main__":
    main()
