#!/usr/bin/env python3
"""Record the OpenManus quick tour: home -> create task -> live timeline.

Run inside the sandbox image (Chromium + Playwright + ffmpeg are preinstalled):

    docker run --rm --entrypoint python3 -v "$PWD:/repo" -v /tmp/tour:/out \
      wiwana/sandbox:0.1.0 /repo/scripts/record_tour.py --base-url http://host.docker.internal:3000 --out /out

Outputs: tour.webm (video), home.png and task.png (stills for the README).
"""

from __future__ import annotations

import argparse
import pathlib
import time


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="录制使用教程")
    parser.add_argument("--base-url", default="http://host.docker.internal:3000")
    parser.add_argument("--out", default="/out")
    parser.add_argument("--prompt", default="写一份 80 字的项目周报，说明本周进展与下周计划")
    parser.add_argument("--wait-seconds", type=int, default=75)
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=800)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    video_dir = out / "video"
    video_dir.mkdir(exist_ok=True)

    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        context = browser.new_context(
            viewport={"width": args.width, "height": args.height},
            locale="zh-CN",
            record_video_dir=str(video_dir),
            record_video_size={"width": args.width, "height": args.height},
        )
        page = context.new_page()
        page.goto(args.base_url, wait_until="domcontentloaded")
        page.wait_for_timeout(2500)
        page.screenshot(path=str(out / "home.png"))

        page.fill("textarea", args.prompt)
        page.wait_for_timeout(1500)
        page.click("text=开始执行")

        page.wait_for_url("**/tasks/**", timeout=20_000)
        page.wait_for_timeout(4000)
        page.screenshot(path=str(out / "task.png"))

        # Let the timeline fill in: status -> tools -> deliverables -> live frames.
        deadline = time.time() + args.wait_seconds
        while time.time() < deadline:
            page.wait_for_timeout(3000)
            try:
                page.mouse.wheel(0, 220)
            except Exception:  # noqa: BLE001
                pass
        page.screenshot(path=str(out / "task-final.png"))

        context.close()
        browser.close()

    videos = sorted(video_dir.glob("*.webm"))
    if videos:
        target = out / "tour.webm"
        videos[-1].replace(target)
        print(f"saved {target}")
    print(f"saved stills in {out}")


if __name__ == "__main__":
    main()
