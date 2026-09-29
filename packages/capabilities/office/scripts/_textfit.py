"""Text measurement and auto-fit helpers shared by the office deliverables.

The rule this module exists to enforce: **a box is sized for its text, never the
other way around**. Chinese glyphs are about as wide as the font size and have no
word boundaries, so a layout that looks fine for English silently overflows once
the content is Chinese (the "字出格" report).

Estimates are intentionally conservative: they trade a slightly larger box for
text that never spills outside its background panel.
"""

from __future__ import annotations

CJK_RANGES = ((0x2E80, 0x9FFF), (0xAC00, 0xD7AF), (0xF900, 0xFAFF), (0xFF00, 0xFF60))
# PowerPoint single spacing for CJK text is ≈1.2× the font size; 1.22 keeps a
# little air. The safety factor absorbs font-substitution differences without
# flagging boxes that are actually fine (the previous 1.38 × fixed padding
# model reported 71% of a healthy deck as overflowing).
# Natural ("single") line height of a CJK font as a multiple of its size.
# Microsoft YaHei ≈1.32em, PingFang SC / Noto Sans CJK ≈1.40em. We take the
# pessimistic end: decks authored with YaHei metrics are routinely opened on
# machines that substitute a taller font, and the extra leading pushes the last
# line outside its panel. PowerPoint's "1.5 lines" multiplies THIS factor.
LINE_HEIGHT_RATIO = 1.38
SAFETY = 1.06
# Vertical allowance for the text frame's own insets (PowerPoint default ≈0.05in
# top + bottom on a real text box, less on autoshapes).
VERTICAL_INSET = 0.06


def is_wide(char: str) -> bool:
    code = ord(char)
    return any(start <= code <= end for start, end in CJK_RANGES)


def text_units(text: str) -> float:
    """Width of the text in units of "one font-size": CJK ≈ 1.0, Latin ≈ 0.55."""
    return sum(1.0 if is_wide(ch) else 0.55 for ch in text)


def wrap(text: str, width_units: float) -> list[str]:
    """Greedy wrap using the same units as `text_units`."""
    lines: list[str] = []
    current = ""
    current_units = 0.0
    token = ""
    token_units = 0.0

    def flush_token() -> None:
        nonlocal current, current_units, token, token_units
        if not token:
            return
        if current_units + token_units > width_units and current:
            lines.append(current)
            current, current_units = "", 0.0
        current += token
        current_units += token_units
        token, token_units = "", 0.0

    for char in text:
        if char == "\n":
            flush_token()
            lines.append(current)
            current, current_units = "", 0.0
            continue
        if char == " ":
            token += char
            token_units += 0.55
            flush_token()
            continue
        if is_wide(char):
            flush_token()
            if current_units + 1.0 > width_units and current:
                lines.append(current)
                current, current_units = "", 0.0
            current += char
            current_units += 1.0
            continue
        token += char
        token_units += 0.55
    flush_token()
    if current:
        lines.append(current)
    return lines or [""]


def padding(font_pt: float) -> float:
    """Real text boxes keep padding proportional to the font, not a fixed inset."""
    return min(0.18, max(0.05, font_pt / 72 * 0.7))


# Viewers without the authored CJK font substitute a wider one (YaHei → PingFang
# / Noto), which re-wraps lines and pushes the block out of its panel. Wrapping
# against 92% of the usable width reserves that difference up front.
WIDTH_SAFETY = 0.92


def lines_for(text: str, box_width_in: float, font_pt: float, padding_in: float | None = None) -> int:
    padding_in = padding(font_pt) if padding_in is None else padding_in
    usable_pt = max(24.0, (box_width_in - padding_in * 2) * 72 * WIDTH_SAFETY)
    return len(wrap(text, usable_pt / font_pt))


def height_for(text: str, box_width_in: float, font_pt: float, padding_in: float | None = None) -> float:
    """Required box height (inches) for `text` at `font_pt` in a box `box_width_in` wide."""
    return (lines_for(text, box_width_in, font_pt) * font_pt * LINE_HEIGHT_RATIO * SAFETY) / 72 + VERTICAL_INSET


def choose_size(text: str, box_width_in: float, box_height_in: float, max_pt: float, min_pt: float) -> tuple[float, int]:
    """Largest size that fits both the available width and the available height."""
    size = max_pt
    while size > min_pt:
        if height_for(text, box_width_in, size) <= box_height_in:
            return size, lines_for(text, box_width_in, size)
        size -= 1
    return min_pt, lines_for(text, box_width_in, min_pt)


def clip(text: str, box_width_in: float, box_height_in: float, font_pt: float, padding_in: float | None = None) -> str:
    """Last-resort truncation so nothing can ever render outside its panel."""
    padding_in = padding(font_pt) if padding_in is None else padding_in
    lines = wrap(text, max(24.0, (box_width_in - padding_in * 2) * 72) / font_pt)
    max_lines = max(1, int((box_height_in - padding_in * 2) * 72 / (font_pt * LINE_HEIGHT_RATIO)))
    if len(lines) <= max_lines:
        return text
    kept = lines[:max_lines]
    last = kept[-1]
    kept[-1] = last[:-1] + "…" if len(last) > 1 else "…"
    return "\n".join(kept)


def panel_roundness(shape) -> float:
    """Corner radius of an autoshape as a fraction of its short side (0 = square)."""
    try:
        adjustment = float(shape.adjustments[0])
    except (IndexError, KeyError, TypeError, ValueError):
        return 0.0
    # python-pptx reports rounded-rectangle adjustments scaled by 100000/norm;
    # values in this deck are 6.0 (60%) and 8.0 (80%).
    return max(0.0, min(1.0, adjustment / 10.0))


def corner_radius(shape) -> float:
    """Effective corner radius in inches, clamped the way renderers clamp it."""
    width = shape.width / 914400 if shape.width else 0.0
    height = shape.height / 914400 if shape.height else 0.0
    return min(panel_roundness(shape) * min(width, height), min(width, height) / 2)


def inside_rounded_rect(px: float, py: float, rect: tuple[float, float, float, float], radius: float) -> bool:
    x1, y1, x2, y2 = rect
    dx = max(x1 + radius - px, 0.0, px - (x2 - radius))
    dy = max(y1 + radius - py, 0.0, py - (y2 - radius))
    return dx * dx + dy * dy <= radius * radius + 1e-9


def bottom_limit_for_box(shape, box_left: float, box_right: float, rect: tuple[float, float, float, float]) -> float:
    """Lowest y a box spanning [box_left, box_right] may reach inside a rounded panel."""
    radius = corner_radius(shape)
    x1, y1, x2, y2 = rect
    if radius <= 0.01:
        return y2
    worst = max(
        max(x1 + radius - box_left, 0.0, box_left - (x2 - radius)),
        max(x1 + radius - box_right, 0.0, box_right - (x2 - radius)),
    )
    return y2 - radius + max(0.0, (radius * radius - worst * worst)) ** 0.5


def text_extent_in(text_frame, box_width_in: float, size_scale: float = 1.0) -> float:
    """Width actually covered by glyphs: the widest wrapped line, in inches.

    Arc / corner tests must use this rather than the text box width — trailing
    whitespace inside a box carries no glyphs and cannot stick out of a panel.
    """
    widest = 0.0
    for paragraph in text_frame.paragraphs:
        text = "".join(run.text for run in paragraph.runs)
        if not text.strip():
            continue
        size = _paragraph_size(paragraph) * size_scale
        usable_pt = max(24.0, (box_width_in - padding(size) * 2) * 72 * WIDTH_SAFETY)
        for line in wrap(text, usable_pt / size):
            widest = max(widest, text_units(line) * size / 72)
    return widest or min(box_width_in, 0.5)


DEFAULT_BODY_PT = 18.0


def _paragraph_size(paragraph) -> float:
    sizes = [run.font.size.pt for run in paragraph.runs if run.font.size is not None]
    if sizes:
        return max(sizes)
    try:
        if paragraph.font.size is not None:
            return paragraph.font.size.pt
    except (AttributeError, ValueError):
        pass
    return DEFAULT_BODY_PT


def _line_height_pt(paragraph, size_pt: float) -> float:
    """Effective line height, honouring `lnSpc` (percentage or points)."""
    spacing = paragraph.line_spacing
    if spacing is None:
        return size_pt * LINE_HEIGHT_RATIO
    if isinstance(spacing, (int, float)):  # multiple, e.g. 1.5
        return size_pt * LINE_HEIGHT_RATIO * float(spacing)
    return float(spacing.pt)  # Length in points


def _space_pt(value) -> float:
    if value is None:
        return 0.0
    return float(value.pt) if hasattr(value, "pt") else float(value)


def frame_text_height(text_frame, box_width_in: float, size_scale: float = 1.0, padding_in: float | None = None) -> float:
    """Height a text frame actually needs, including line and paragraph spacing.

    This is the metric that matters for real decks: a card body at 18pt with
    `lnSpc 150%` plus 4pt/2pt paragraph spacing needs ~1.4in, not the ~1.0in a
    naive "font size × line count" estimate reports — which is exactly how text
    ended up hanging outside its panel.
    """
    paragraphs = list(text_frame.paragraphs)
    total_pt = 0.0
    rendered = [p for p in paragraphs if "".join(run.text for run in p.runs).strip()]
    total_lines = sum(
        lines_for("".join(run.text for run in p.runs), box_width_in, _paragraph_size(p) * size_scale, padding_in)
        for p in rendered
    )
    single_line = total_lines <= 1
    last_leading = 0.0
    for index, paragraph in enumerate(paragraphs):
        size = _paragraph_size(paragraph) * size_scale
        text = "".join(run.text for run in paragraph.runs)
        if not text.strip():
            total_pt += _line_height_pt(paragraph, size) * 0.5
            continue
        lines = lines_for(text, box_width_in, size, padding_in)
        if single_line:
            total_pt += size * 1.2
        else:
            total_pt += lines * _line_height_pt(paragraph, size)
            last_leading = max(0.0, _line_height_pt(paragraph, size) - size * 1.2)
        # Only the spacing *between* paragraphs consumes height: a leading
        # space-before on the first paragraph or a trailing space-after on the
        # last one does not push glyphs outside a top-anchored frame.
        if index > 0:
            total_pt += _space_pt(paragraph.space_before)
        if index < len(paragraphs) - 1:
            total_pt += _space_pt(paragraph.space_after)
    # The leading below the final baseline is invisible, so it does not count
    # towards the box the text needs.
    return (total_pt - last_leading) / 72 + VERTICAL_INSET
