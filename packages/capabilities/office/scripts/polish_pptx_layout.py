#!/usr/bin/env python3
"""Polish a deck's composition without touching its design language.

For every colour panel, the text blocks that live inside it are treated as ONE
group and centred inside the panel:

  * horizontally — equal left/right margins for the group;
  * vertically   — equal top/bottom margins for the group;

Individual left edges inside the group are preserved, so a card that is
left-aligned stays left-aligned; only its placement inside the panel changes.
The shift is clamped so every block stays inside the panel's rounded-corner
safe area.

Usage: python3 polish_pptx_layout.py --file deck.pptx [--out deck-polished.pptx]
"""

from __future__ import annotations

import argparse
import os
import sys

from pptx import Presentation
from pptx.util import Emu

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _textfit import bottom_limit_for_box, corner_radius, frame_text_height, text_extent_in  # noqa: E402

EMU = 914400
PAD = 0.22
MIN_PANEL_AREA = 1.2  # square inches


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="对齐 PPT 文案与色块（居中构图）")
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


def is_panel(shape) -> bool:
    if not str(shape.shape_type).startswith("AUTO_SHAPE"):
        return False
    if getattr(shape, "has_text_frame", False) and shape.text_frame.text.strip():
        return False
    width = (shape.width or 0) / EMU
    height = (shape.height or 0) / EMU
    return width * height >= MIN_PANEL_AREA and width >= 1.5 and height >= 0.5


def contains(panel_rect: tuple[float, float, float, float], box_rect: tuple[float, float, float, float]) -> bool:
    return (
        box_rect[0] >= panel_rect[0] - 0.05
        and box_rect[2] <= panel_rect[2] + 0.05
        and box_rect[1] >= panel_rect[1] - 0.05
        and box_rect[1] <= panel_rect[3] - 0.2
    )


def free_below(panel, shapes) -> float:
    """Vertical room under a panel before it would collide with the next shape."""
    left, top, right, bottom = rect(panel)
    limit = 7.5 - 0.12
    for other in shapes:
        if other is panel:
            continue
        o_left, o_top, o_right, _ = rect(other)
        if o_top < bottom - 0.02:
            continue
        overlap = max(0.0, min(right, o_right) - max(left, o_left))
        if overlap < (right - left) * 0.25:
            continue
        limit = min(limit, o_top - 0.06)
    return max(0.0, limit - bottom)


def main() -> None:
    args = parse_args()
    output = args.out or args.file.replace(".pptx", "-polished.pptx")
    presentation = Presentation(args.file)

    moved_groups = 0
    for slide in presentation.slides:
        shapes = list(slide.shapes)
        panels = [s for s in shapes if is_panel(s)]
        boxes = [s for s in shapes if getattr(s, "has_text_frame", False) and s.text_frame.text.strip()]

        for panel in panels:
            panel_rect = rect(panel)
            group = [b for b in boxes if contains(panel_rect, rect(b))]
            if not group:
                continue
            # the panel must own these blocks: nothing else may sit between them
            others = [s for s in panels if s is not panel and contains(rect(panel), (rect(s)[0], rect(s)[1], rect(s)[2], rect(s)[1] + 0.1))]
            if others:
                continue

            # Compact oversized boxes first: the overflow pass grows boxes to give
            # text room, which then eats the slack needed for centring. A box only
            # has to be as tall as its own text.
            for box in group:
                need = frame_text_height(box.text_frame, (box.width or 0) / EMU)
                if need + 0.02 < (box.height or 0) / EMU:
                    box.height = Emu(int((need + 0.02) * EMU))

            g_left = min((b.left or 0) / EMU for b in group)
            g_right = max(((b.left or 0) + (b.width or 0)) / EMU for b in group)
            g_top = min((b.top or 0) / EMU for b in group)
            g_bottom = max(((b.top or 0) + (b.height or 0)) / EMU for b in group)

            # Safe area: pad the panel and respect the arc limit of every member,
            # computed with the box's own horizontal span. The group is shifted as
            # a whole so the members keep their relative spacing.
            radius = corner_radius(panel)
            safe_left = panel_rect[0] + PAD
            safe_right = panel_rect[2] - PAD
            safe_top = panel_rect[1] + max(PAD, radius * 0.5)
            arc_bottom = min(
                bottom_limit_for_box(
                    panel,
                    (b.left or 0) / EMU,
                    (b.left or 0) / EMU + text_extent_in(b.text_frame, (b.width or 0) / EMU),
                    panel_rect,
                )
                for b in group
            )
            safe_bottom = min(panel_rect[3] - PAD, arc_bottom)

            # Content taller than the safe band: give the panel the room it needs
            # so the group can sit centred with symmetric margins.
            group_height = g_bottom - g_top
            if group_height + 0.2 > safe_bottom - safe_top:
                need = (group_height + 0.2) - (safe_bottom - safe_top)
                room = free_below(panel, shapes)
                if room > 0.03:
                    grow = min(need, room)
                    panel.height = Emu(int(((panel.height or 0) / EMU + grow) * EMU))
                    panel_rect = rect(panel)
                    radius = corner_radius(panel)
                    safe_top = panel_rect[1] + max(PAD, radius * 0.5)
                    arc_bottom = min(
                        bottom_limit_for_box(panel, (b.left or 0) / EMU, ((b.left or 0) + (b.width or 0)) / EMU, panel_rect)
                        for b in group
                    )
                    safe_bottom = min(panel_rect[3] - PAD, arc_bottom)
                    moved_groups += 1

            dx = ((safe_left + safe_right) / 2) - ((g_left + g_right) / 2)
            if g_right - g_left <= safe_right - safe_left:
                dx = max(safe_left - g_left, min(dx, safe_right - g_right))
            else:
                dx = safe_left - g_left

            if safe_bottom - safe_top >= g_bottom - g_top:
                dy = ((safe_top + safe_bottom) / 2) - ((g_top + g_bottom) / 2)
                dy = max(safe_top - g_top, min(dy, safe_bottom - g_bottom))
            else:
                # Not enough room to centre: keep the group as high as the safe
                # area allows rather than letting members overlap.
                dy = safe_top - g_top

            if abs(dx) < 0.01 and abs(dy) < 0.01:
                continue
            for box in group:
                box.left = Emu(int(((box.left or 0) / EMU + dx) * EMU))
                box.top = Emu(int(((box.top or 0) / EMU + dy) * EMU))
            moved_groups += 1

            # Final safety: if centring pushed any member past the arc, lift the
            # WHOLE group by the worst excess so relative spacing is preserved.
            worst = 0.0
            for box in group:
                limit = bottom_limit_for_box(
                    panel,
                    (box.left or 0) / EMU,
                    (box.left or 0) / EMU + text_extent_in(box.text_frame, (box.width or 0) / EMU),
                    panel_rect,
                )
                bottom = (box.top or 0) / EMU + frame_text_height(box.text_frame, (box.width or 0) / EMU)
                worst = max(worst, bottom - limit)
            if 0 < worst <= 0.35:
                lift = worst + 0.02
                if g_top - lift >= panel_rect[1] + 0.06:
                    for box in group:
                        box.top = Emu(int(((box.top or 0) / EMU - lift) * EMU))

    presentation.save(output)
    print(f"saved {output}")
    print(f"  居中处理的文案组: {moved_groups}")


if __name__ == "__main__":
    main()
