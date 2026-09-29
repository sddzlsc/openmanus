"""Shared helpers for office capability scripts (pure stdlib)."""

from __future__ import annotations

import argparse
import os
import sys

CJK_FONT_CANDIDATES = [
    "Noto Sans CJK SC",
    "Noto Sans CJK",
    "Source Han Sans SC",
    "PingFang SC",
    "Microsoft YaHei",
    "WenQuanYi Zen Hei",
]


def parse_args(description: str) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--title", required=True)
    parser.add_argument("--prompt", default="")
    parser.add_argument("--out", default=os.environ.get("WIWANA_WORKSPACE", "/workspace"))
    parser.add_argument(
        "--content",
        default=None,
        help="可选：JSON 幻灯片内容文件（[{\"title\":…,\"bullets\":[…]}]），用于按既有内容重排而不重新创作",
    )
    return parser.parse_args()


def ensure_out(path: str) -> str:
    os.makedirs(path, exist_ok=True)
    return os.path.abspath(path)


def sections(prompt: str) -> list[tuple[str, list[str]]]:
    """Deterministic outline used when no model text is available."""
    topic = (prompt or "任务").strip().replace("\n", " ")
    if len(topic) > 80:
        topic = topic[:80] + "…"
    return [
        ("背景与目标", [f"本文件围绕「{topic}」展开。", "目标是把需求转化为可直接使用的交付物。"]),
        ("现状分析", ["梳理关键事实、约束条件与已知输入。", "识别风险点与需要用户确认的信息。"]),
        ("方案与执行", ["给出分步骤方案，明确每步产出与负责人。", "对关键环节设置校验点，避免返工。"]),
        ("结论与建议", ["优先推进收益明确、依赖最少的事项。", "对不确定项给出备选方案与决策点。"]),
    ]


def fail(message: str, code: int = 3) -> None:
    print(f"[capability-error] {message}", file=sys.stderr)
    raise SystemExit(code)
