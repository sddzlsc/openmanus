#!/usr/bin/env python3
"""Generate a PDF deliverable. Uses reportlab with a built-in CJK CID font."""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import ensure_out, fail, parse_args, sections  # noqa: E402


def main() -> None:
    args = parse_args("导出 PDF")
    out = ensure_out(args.out)
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.lib.units import mm
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
    except ImportError:
        fail("reportlab 未安装（沙箱镜像应包含 reportlab）")

    font_name = "STSong-Light"
    try:
        pdfmetrics.registerFont(UnicodeCIDFont(font_name))
    except Exception:  # noqa: BLE001 - fall back to Helvetica when CID fonts are unavailable
        font_name = "Helvetica"

    title_style = ParagraphStyle("title", fontName=font_name, fontSize=22, leading=30, spaceAfter=12)
    body_style = ParagraphStyle("body", fontName=font_name, fontSize=11.5, leading=20, spaceAfter=8)
    heading_style = ParagraphStyle("heading", fontName=font_name, fontSize=15, leading=22, spaceBefore=12, spaceAfter=6)

    story = [Paragraph(escape(args.title), title_style), Paragraph(f"需求：{escape(args.prompt)}", body_style), Spacer(1, 6)]
    for heading, paragraphs in sections(args.prompt):
        story.append(Paragraph(escape(heading), heading_style))
        for paragraph in paragraphs:
            story.append(Paragraph(escape(paragraph), body_style))

    target = os.path.join(out, "deliverable.pdf")
    document = SimpleDocTemplate(
        target,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=args.title,
    )
    document.build(story)
    print(f"saved {target}")


def escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


if __name__ == "__main__":
    main()
