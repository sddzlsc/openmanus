#!/usr/bin/env python3
"""Generate a deck whose text always fits its box (no more 字出格).

Two modes:
  * default      — deterministic outline derived from `--prompt`
  * `--content`  — render an explicit JSON deck: [{"title":…, "subtitle":…, "bullets":[…]}, …]

Every text frame goes through `_textfit`: the box height is derived from the
wrapped text, the font shrinks only within a floor/ceiling band, and the frame
declares an explicit autofit scale so viewers do not re-wrap it into overflow.
"""

from __future__ import annotations

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import ensure_out, fail, parse_args, sections  # noqa: E402
from _textfit import choose_size, clip, height_for  # noqa: E402

from pptx import Presentation  # noqa: E402
from pptx.dml.color import RGBColor  # noqa: E402
from pptx.enum.shapes import MSO_SHAPE  # noqa: E402
from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE, PP_ALIGN  # noqa: E402
from pptx.oxml.ns import qn  # noqa: E402
from pptx.util import Emu, Inches, Pt  # noqa: E402

SLIDE_W, SLIDE_H = 13.333, 7.5
MARGIN = 0.62
GAP = 0.22
FOOTER_H = 0.42

INK = RGBColor(0x16, 0x1B, 0x23)
MUTED = RGBColor(0x53, 0x5F, 0x6E)
ACCENT = RGBColor(0x2F, 0x5B, 0xFF)
CARD_BG = RGBColor(0xF4, 0xF6, 0xFB)
CARD_BG_ALT = RGBColor(0xEE, 0xF2, 0xFF)
BAND = RGBColor(0x0F, 0x1B, 0x33)

CJK_FONT = "Noto Sans CJK SC"
FALLBACK = "Microsoft YaHei"


def cm_to_emu(value_in: float) -> Emu:
    return Inches(value_in)


def apply_font(run, size_pt: float, *, bold: bool = False, color: RGBColor = INK) -> None:
    font = run.font
    font.size = Pt(size_pt)
    font.bold = bold
    font.color.rgb = color
    font.name = CJK_FONT
    # East Asian + complex-script typefaces must be set explicitly, otherwise
    # PowerPoint/WPS substitute a font with different metrics and re-wrap.
    properties = run._r.get_or_add_rPr()
    for tag in ("a:ea", "a:cs"):
        element = properties.find(qn(tag))
        if element is None:
            element = properties.makeelement(qn(tag), {})
            properties.append(element)
        element.set("typeface", CJK_FONT)
    latin = properties.find(qn("a:latin"))
    if latin is None:
        latin = properties.makeelement(qn("a:latin"), {})
        properties.insert(0, latin)
    latin.set("typeface", CJK_FONT)


def declare_autofit(text_frame) -> None:
    """Write an explicit `normAutofit` so every viewer honors our sizing."""
    body = text_frame._txBody
    body_pr = body.find(qn("a:bodyPr"))
    if body_pr is None:
        body_pr = body.makeelement(qn("a:bodyPr"), {})
        body.insert(0, body_pr)
    for existing in body_pr.findall(qn("a:normAutofit")):
        body_pr.remove(existing)
    autofit = body_pr.makeelement(qn("a:normAutofit"), {"fontScale": "100000", "lnSpcReduction": "0"})
    body_pr.append(autofit)


def add_text(
    slide,
    text: str,
    *,
    left: float,
    top: float,
    width: float,
    height: float,
    max_pt: float,
    min_pt: float,
    bold: bool = False,
    color: RGBColor = INK,
    align=PP_ALIGN.LEFT,
    anchor=MSO_ANCHOR.TOP,
) -> None:
    """Add a text box that is guaranteed to fit: size is chosen, else clipped."""
    size, _ = choose_size(text, width, height, max_pt, min_pt)
    fitted = clip(text, width, height, size)
    box = slide.shapes.add_textbox(cm_to_emu(left), cm_to_emu(top), cm_to_emu(width), cm_to_emu(height))
    frame = box.text_frame
    frame.word_wrap = True
    frame.auto_size = MSO_AUTO_SIZE.NONE
    frame.vertical_anchor = anchor
    frame.margin_left = Inches(0.08)
    frame.margin_right = Inches(0.08)
    frame.margin_top = Inches(0.04)
    frame.margin_bottom = Inches(0.04)
    for index, line in enumerate(fitted.split("\n")):
        paragraph = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
        paragraph.alignment = align
        run = paragraph.add_run()
        run.text = line
        apply_font(run, size, bold=bold, color=color)
    declare_autofit(frame)


def add_card(slide, *, left: float, top: float, width: float, height: float, index: int, item: dict) -> None:
    card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, cm_to_emu(left), cm_to_emu(top), cm_to_emu(width), cm_to_emu(height))
    card.fill.solid()
    card.fill.fore_color.rgb = CARD_BG if index % 2 == 0 else CARD_BG_ALT
    card.line.fill.background()
    card.shadow.inherit = False
    try:
        card.adjustments[0] = 0.06
    except (IndexError, KeyError):
        pass

    pad = 0.22
    inner_w = width - pad * 2
    inner_h = height - pad * 2
    heading = item.get("title") or ""
    body = item.get("body") or ""

    cursor = top + pad
    if heading:
        # Size the heading box from the font we can actually afford, so the box
        # is never smaller than its own text.
        heading_size, _ = choose_size(heading, inner_w, inner_h * 0.55, 17, 12)
        heading_h = max(0.28, height_for(heading, inner_w, heading_size))
        add_text(
            slide,
            heading,
            left=left + pad,
            top=cursor,
            width=inner_w,
            height=heading_h,
            max_pt=heading_size,
            min_pt=heading_size,
            bold=True,
            color=INK,
        )
        cursor += heading_h + 0.06
    if body:
        remaining = max(0.4, inner_h - (cursor - top - pad))
        add_text(
            slide,
            body,
            left=left + pad,
            top=cursor,
            width=inner_w,
            height=remaining,
            max_pt=13.5,
            min_pt=9,
            color=MUTED,
        )


def add_title_bar(slide, title: str, subtitle: str, page: int, total: int) -> float:
    band = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, cm_to_emu(0), cm_to_emu(0), cm_to_emu(SLIDE_W), cm_to_emu(0.16))
    band.fill.solid()
    band.fill.fore_color.rgb = ACCENT
    band.line.fill.background()

    title_w = SLIDE_W - MARGIN * 2
    title_h = min(1.3, max(0.62, height_for(title, title_w, 30)))
    add_text(
        slide,
        title,
        left=MARGIN,
        top=0.38,
        width=title_w,
        height=title_h,
        max_pt=30,
        min_pt=18,
        bold=True,
        color=INK,
    )
    cursor = 0.38 + title_h + 0.12
    if subtitle:
        subtitle_h = min(0.9, max(0.42, height_for(subtitle, title_w, 14)))
        add_text(
            slide,
            subtitle,
            left=MARGIN,
            top=cursor,
            width=title_w,
            height=subtitle_h,
            max_pt=14,
            min_pt=10,
            color=MUTED,
        )
        cursor += subtitle_h + 0.08
    add_text(
        slide,
        f"{page} / {total}",
        left=SLIDE_W - MARGIN - 1.0,
        top=SLIDE_H - FOOTER_H,
        width=1.0,
        height=max(0.3, height_for(f"{page} / {total}", 1.0, 10)),
        max_pt=10,
        min_pt=8,
        color=MUTED,
        align=PP_ALIGN.RIGHT,
    )
    return cursor


def render_deck(deck: list[dict], out_path: str) -> None:
    presentation = Presentation()
    presentation.slide_width = Inches(SLIDE_W)
    presentation.slide_height = Inches(SLIDE_H)
    blank = presentation.slide_layouts[6]

    # ── cover ───────────────────────────────────────────────────────────────
    cover = presentation.slides.add_slide(blank)
    backdrop = cover.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(SLIDE_W), Inches(SLIDE_H))
    backdrop.fill.solid()
    backdrop.fill.fore_color.rgb = BAND
    backdrop.line.fill.background()
    cover_title = deck[0].get("title", "演示文稿")
    cover_subtitle = deck[0].get("subtitle", "")
    add_text(
        cover,
        cover_title,
        left=0.9,
        top=2.4,
        width=SLIDE_W - 1.8,
        height=1.6,
        max_pt=40,
        min_pt=24,
        bold=True,
        color=RGBColor(0xFF, 0xFF, 0xFF),
    )
    add_text(
        cover,
        cover_subtitle or "由 Wiwana 智能体生成",
        left=0.9,
        top=4.25,
        width=SLIDE_W - 1.8,
        height=0.8,
        max_pt=16,
        min_pt=11,
        color=RGBColor(0xC7, 0xD2, 0xFE),
    )

    # ── content slides ──────────────────────────────────────────────────────
    content_slides = deck[1:] or deck
    total = len(content_slides)
    for page, slide_data in enumerate(content_slides, start=1):
        slide = presentation.slides.add_slide(blank)
        title = slide_data.get("title", f"第 {page} 页")
        subtitle = slide_data.get("subtitle", "")
        content_top = add_title_bar(slide, title, subtitle, page, total)

        items: list[dict] = []
        for bullet in slide_data.get("bullets", []):
            if isinstance(bullet, dict):
                items.append({"title": bullet.get("title", ""), "body": bullet.get("body", "")})
            else:
                text = str(bullet)
                head, _, tail = text.partition("：")
                items.append({"title": head if tail else "", "body": tail if tail else text})
        if not items:
            items = [{"title": "", "body": title}]

        available_h = SLIDE_H - content_top - FOOTER_H - 0.18
        columns = 1 if len(items) <= 3 else (2 if len(items) <= 8 else 3)
        rows = math.ceil(len(items) / columns)
        card_w = (SLIDE_W - MARGIN * 2 - GAP * (columns - 1)) / columns
        card_h = (available_h - GAP * (rows - 1)) / rows

        for index, item in enumerate(items):
            row, column = divmod(index, columns)
            add_card(
                slide,
                left=MARGIN + column * (card_w + GAP),
                top=content_top + row * (card_h + GAP),
                width=card_w,
                height=card_h,
                index=index,
                item=item,
            )

    presentation.save(out_path)


def load_content(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    if isinstance(data, dict):
        data = data.get("slides", [])
    if not isinstance(data, list) or not data:
        fail("--content 需要是非空的 JSON 数组")
    return data


def main() -> None:
    args = parse_args("生成 PPT 演示文稿（文字自适应排版）")
    out = ensure_out(args.out)
    content_path = getattr(args, "content", None)

    if content_path:
        deck = load_content(content_path)
    else:
        deck = [{"title": args.title, "subtitle": args.prompt[:120]}]
        for heading, paragraphs in sections(args.prompt):
            deck.append(
                {
                    "title": heading,
                    "bullets": [{"title": paragraph.split("，")[0][:14], "body": paragraph} for paragraph in paragraphs],
                }
            )

    target = os.path.join(out, "deck.pptx")
    render_deck(deck, target)
    print(f"saved {target} ({len(deck)} slides, text auto-fitted)")


if __name__ == "__main__":
    main()
