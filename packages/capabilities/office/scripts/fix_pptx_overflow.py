#!/usr/bin/env python3
"""Fix text overflow in an existing deck WITHOUT touching its design.

Strategy, in order (cheapest visual change first):
  1. grow the text box downward into free space (bounded by the panel it sits
     in, the next shape below it, and the slide edge);
  2. shrink the font, but at most to 72% of the authored size, and record the
     real `normAutofit fontScale` so every viewer honours it;
  3. clip the tail with an ellipsis (last resort, reported).

Usage: python3 fix_pptx_overflow.py --file deck.pptx [--out deck-fixed.pptx]
"""

from __future__ import annotations

import argparse
import os
import sys

from pptx import Presentation
from pptx.util import Emu, Pt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _textfit import (  # noqa: E402
    bottom_limit_for_box,
    clip,
    corner_radius,
    frame_text_height,
    panel_roundness,
    text_extent_in,
)

EMU = 914400
MIN_SCALE = 0.72
# The line-height model above already carries ~5% of slack (1.38 vs a 1.32em
# real line height), so the box may be filled to fit exactly; demanding extra
# headroom here just shrinks type that was already fine.
COMFORT = 1.0
GAP = 0.06
# Blob panels (rounded rectangles at 60–80% radius) leave almost no usable area
# near their corners, which is where the last text line lands. Softening the
# radius to this value keeps the "rounded card" look, gives the text a
# rectangular safe area, and avoids shrinking type to unreadable sizes.
MAX_RADIUS = 0.2


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="修复 PPTX 文字溢出（保留原设计）")
    parser.add_argument("--file", required=True)
    parser.add_argument("--out", default=None)
    return parser.parse_args()


def rect(shape) -> tuple[float, float, float, float]:
    return (
        (shape.left or 0) / EMU,
        (shape.top or 0) / EMU,
        ((shape.left or 0) + (shape.width or 0)) / EMU,
        ((shape.top or 0) + (shape.height or 0)) / EMU,
    )


def overlap_ratio(a: tuple[float, float], b: tuple[float, float]) -> float:
    left, right = max(a[0], b[0]), min(a[1], b[1])
    if right <= left:
        return 0.0
    return (right - left) / max(1e-6, min(a[1] - a[0], b[1] - b[0]))


def font_sizes(shape) -> list[float]:
    return [
        run.font.size.pt
        for paragraph in shape.text_frame.paragraphs
        for run in paragraph.runs
        if run.font.size is not None
    ]


def set_font_scale(text_frame, scale: float) -> None:
    """Write `normAutofit fontScale` so viewers do not re-wrap into overflow."""
    from pptx.oxml.ns import qn

    body = text_frame._txBody
    body_pr = body.find(qn("a:bodyPr"))
    if body_pr is None:
        return
    for existing in body_pr.findall(qn("a:normAutofit")):
        body_pr.remove(existing)
    autofit = body_pr.makeelement(
        qn("a:normAutofit"),
        {"fontScale": str(max(1000, int(scale * 100000))), "lnSpcReduction": "0"},
    )
    body_pr.append(autofit)


def find_panel(shape, shapes):
    """The filled shape this text box sits inside, if any."""
    left, top, right, bottom = rect(shape)
    best = None
    for other in shapes:
        if other is shape:
            continue
        o_left, o_top, o_right, o_bottom = rect(other)
        # A container must actually wrap the content: a decorative strip that
        # merely crosses the top edge is not a panel boundary.
        if o_top <= top + 0.02 and o_bottom >= top + 0.3 and overlap_ratio((left, right), (o_left, o_right)) > 0.6:
            if best is None or (o_bottom - o_top) > (rect(best)[3] - rect(best)[1]):
                best = other
    return best


def usable_height(shape, shapes, slide_h: float) -> float:
    """How tall this text box may become without leaving its panel or hitting another shape."""
    left, top, right, bottom = rect(shape)
    limit = slide_h - 0.12

    # Panel containment: the box must stay inside its own colour panel.
    panel = find_panel(shape, shapes)
    if panel is not None:
        limit = min(limit, rect(panel)[3] - GAP)

    # Obstacles below: anything starting under this box in the same column band.
    for other_shape in shapes:
        if other_shape is shape:
            continue
        other = rect(other_shape)
        o_left, o_top, o_right, o_bottom = other
        if o_top < bottom - 0.02:
            continue
        if overlap_ratio((left, right), (o_left, o_right)) < 0.25:
            continue
        limit = min(limit, o_top - GAP)

    return max(0.2, limit - top)


def main() -> None:
    args = parse_args()
    output = args.out or args.file.replace(".pptx", "-fixed.pptx")
    presentation = Presentation(args.file)
    slide_h = presentation.slide_height / EMU

    grown = softened = shrunk = clipped = 0
    for slide in presentation.slides:
        shapes = [s for s in slide.shapes if getattr(s, "has_text_frame", False) and s.text_frame.text.strip()]
        slide_shapes = list(slide.shapes)

        for shape in shapes:
            sizes = font_sizes(shape)
            if not sizes:
                continue
            current_size = max(sizes)
            width_in = (shape.width or 0) / EMU
            top = (shape.top or 0) / EMU
            height_in = (shape.height or 0) / EMU
            needed = frame_text_height(shape.text_frame, width_in)

            # 0. Soften an extreme corner radius first: blob panels (60–80%) leave
            #    no usable area at the corners, and text there reads as "字出来了".
            #    A gentler radius keeps the look and keeps the type size.
            panel = find_panel(shape, slide_shapes)
            if panel is not None and panel_roundness(panel) > MAX_RADIUS:
                try:
                    panel.adjustments[0] = MAX_RADIUS * 10
                    softened += 1
                except (IndexError, KeyError, TypeError, ValueError):
                    pass

            # 1. Room available to this text box: its own growth plus the panel's
            #    free space below, minus the rounded-corner safe line.
            room = height_in
            if panel is not None:
                panel_free = usable_height(panel, slide_shapes, slide_h) - (rect(panel)[3] - rect(panel)[1])
                want = max(0.0, needed / COMFORT - height_in)
                if panel_free > 0.03 and want > 0.03:
                    grow = min(want, panel_free)
                    panel.height = Emu(int(((panel.height or 0) / EMU + grow) * EMU))
                    grown += 1
                extent_right = rect(shape)[0] + text_extent_in(shape.text_frame, width_in)
                limit_bottom = bottom_limit_for_box(panel, rect(shape)[0], extent_right, rect(panel))
            else:
                limit_bottom = top + usable_height(shape, slide_shapes, slide_h)
            room = max(height_in, min(usable_height(shape, slide_shapes, slide_h), limit_bottom - top))
            if room > height_in + 0.02:
                shape.height = Emu(int(room * EMU))
                height_in = room

            # 2. Fit the text into that room, shrinking at most to MIN_SCALE once.
            floor = max(8.0, current_size * MIN_SCALE)
            size = current_size
            while size > floor and frame_text_height(shape.text_frame, width_in, size / current_size) > height_in * COMFORT:
                size = round(size - 0.5, 1)
            if size < current_size - 0.01:
                ratio = size / current_size
                for paragraph in shape.text_frame.paragraphs:
                    for run in paragraph.runs:
                        if run.font.size is not None:
                            run.font.size = Pt(run.font.size.pt * ratio)
                set_font_scale(shape.text_frame, 1.0)
                shrunk += 1

            # 3. Still marginally over the safe line? Nudge the box up instead of
            #    shrinking further.
            residual = top + frame_text_height(shape.text_frame, width_in) - limit_bottom
            if 0 < residual <= 0.16:
                if panel is not None:
                    ceiling = rect(panel)[1] + corner_radius(panel) + 0.04
                else:
                    ceiling = 0.2
                shift = min(residual + 0.02, max(0.0, top - ceiling))
                if shift > 0.005:
                    shape.top = Emu(int((top - shift) * EMU))

            # 4. Absolute last resort: clip so nothing can render outside.
            if frame_text_height(shape.text_frame, width_in) > height_in + 0.01:
                kept = clip(shape.text_frame.text, width_in, height_in, size).split("\n")
                frame = shape.text_frame
                for paragraph in list(frame.paragraphs):
                    for run in list(paragraph.runs):
                        run._r.getparent().remove(run._r)
                for index, line in enumerate(kept):
                    paragraph = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
                    run = paragraph.add_run()
                    run.text = line
                    run.font.size = Pt(size)
                clipped += 1

    presentation.save(output)
    print(f"saved {output}")
    print(f"  撑高: {grown} | 圆角软化: {softened} | 字号调整: {shrunk} | 截断: {clipped}")


if __name__ == "__main__":
    main()
