#!/usr/bin/env python3
"""Validate a generated deck for text that would render outside its box.

Usage: python3 check_pptx.py --file deck.pptx [--json]

Exit code 1 means at least one text box is at risk of 字出格 (text spilling out
of its background panel). The agent is expected to fix the deck and re-run this
checker before delivering it.
"""

from __future__ import annotations

import argparse
import json
import sys

from pptx import Presentation
from pptx.util import Emu

sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from _textfit import bottom_limit_for_box, frame_text_height, lines_for, text_extent_in, _paragraph_size  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="检查 PPTX 文本是否溢出文本框")
    parser.add_argument("--file", required=True)
    parser.add_argument("--json", action="store_true", help="以 JSON 输出")
    parser.add_argument("--tolerance", type=float, default=1.05, help="允许的高度冗余倍数")
    return parser.parse_args()


def autofit_scale(shape) -> float:
    """Declared `normAutofit` fontScale (1.0 when absent)."""
    xml = shape.text_frame._txBody.xml
    marker = 'fontScale="'
    index = xml.find(marker)
    if index < 0:
        return 1.0
    start = index + len(marker)
    end = xml.find('"', start)
    try:
        return int(xml[start:end]) / 100000
    except ValueError:
        return 1.0


def iter_text_shapes(shape, out):
    if shape.shape_type == 6 or getattr(shape, "shapes", None):  # group
        for child in getattr(shape, "shapes", []):
            iter_text_shapes(child, out)
        return
    if getattr(shape, "has_text_frame", False) and shape.text_frame.text.strip():
        out.append(shape)


def main() -> None:
    args = parse_args()
    presentation = Presentation(args.file)
    slide_w_emu = presentation.slide_width
    slide_h_emu = presentation.slide_height
    issues = []
    boxes_checked = 0

    for slide_number, slide in enumerate(presentation.slides, start=1):
        shapes = []
        for shape in slide.shapes:
            iter_text_shapes(shape, shapes)
        for shape in shapes:
            boxes_checked += 1
            width_in = shape.width / 914400
            height_in = shape.height / 914400
            left_in = shape.left / 914400
            top_in = shape.top / 914400
            scale = autofit_scale(shape)

            font_pt = max([_paragraph_size(p) for p in shape.text_frame.paragraphs] or [18.0]) * scale
            needed = frame_text_height(shape.text_frame, width_in, size_scale=scale)

            reasons = []
            if needed > height_in:
                reasons.append(
                    f"文本需要 {needed:.2f}in，文本框只有 {height_in:.2f}in"
                    f"（{lines_for(shape.text_frame.text, width_in, font_pt)} 行 @{font_pt:.1f}pt，含行距/段间距）"
                )
            if left_in < -0.02 or top_in < -0.02 or left_in + width_in > slide_w_emu / 914400 + 0.02 or top_in + height_in > slide_h_emu / 914400 + 0.02:
                reasons.append("文本框超出画布边界")
            # Blob / heavily rounded panels: the text box's bottom corners must
            # stay inside the visible arc, not just inside the bounding rect.
            rounded = next(
                (
                    other
                    for other in slide.shapes
                    if other is not shape
                    and (other.top or 0) / 914400 <= top_in + 0.02
                    and ((other.top or 0) + (other.height or 0)) / 914400 >= top_in + 0.3
                    and (other.left or 0) / 914400 <= left_in
                    and ((other.left or 0) + (other.width or 0)) / 914400 >= left_in + width_in
                ),
                None,
            )
            if rounded is not None:
                panel_rect = (
                    (rounded.left or 0) / 914400,
                    (rounded.top or 0) / 914400,
                    ((rounded.left or 0) + (rounded.width or 0)) / 914400,
                    ((rounded.top or 0) + (rounded.height or 0)) / 914400,
                )
                limit = bottom_limit_for_box(rounded, left_in, left_in + text_extent_in(shape.text_frame, width_in), panel_rect)
                if top_in + needed > limit + 0.01:
                    reasons.append(f"文字落到色块弧线之外：文本底部 {top_in + needed:.2f}in 超过安全线 {limit:.2f}in（圆角面板）")
            if reasons:
                issues.append(
                    {
                        "slide": slide_number,
                        "shape": shape.name,
                        "text": shape.text_frame.text.replace("\n", " / ")[:60],
                        "box_in": [round(width_in, 2), round(height_in, 2)],
                        "reasons": reasons,
                    }
                )

    if args.json:
        print(json.dumps({"checked": boxes_checked, "issues": issues}, ensure_ascii=False, indent=2))
    else:
        print(f"检查了 {boxes_checked} 个文本框，发现问题 {len(issues)} 个")
        for issue in issues:
            print(f"  第 {issue['slide']} 页 · {issue['shape']} · [{issue['box_in'][0]}x{issue['box_in'][1]}in] {issue['text']}")
            for reason in issue["reasons"]:
                print(f"      - {reason}")
    raise SystemExit(1 if issues else 0)


if __name__ == "__main__":
    main()
