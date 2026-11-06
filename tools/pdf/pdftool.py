#!/usr/bin/env python3
"""PDF and image helper for the quiz app's Materials (materials.js runs it; PyMuPDF does the work).

  pdftool.py info   <file.pdf>                         → JSON {pages, labels[], chars[]} (chars: text per page)
  pdftool.py text   <file.pdf> <i,j,...>               → JSON {pages: [{i, text}]}
  pdftool.py slice  <file.pdf> <out.pdf> <i,j,...>     → a PDF with just those pages (0-based), in that order
  pdftool.py render <file.pdf> <out_dir> <width> <i,..> → <out_dir>/<i>.jpg for each page
  pdftool.py image  <in> <out.jpg> <max_px>             → a photo or screenshot as a JPEG at most max_px wide/high
"""
import json
import os
import sys

import pymupdf


def pages_arg(s):
    return [int(x) for x in s.split(",") if x.strip() != ""]


def info(path):
    doc = pymupdf.open(path)
    labels, chars = [], []
    for page in doc:
        try:
            labels.append(page.get_label() or "")
        except Exception:
            labels.append("")
        chars.append(len(page.get_text().strip()))
    print(json.dumps({"pages": doc.page_count, "labels": labels, "chars": chars,
                      "title": (doc.metadata or {}).get("title") or ""}))


def text(path, idx):
    doc = pymupdf.open(path)
    print(json.dumps({"pages": [{"i": i, "text": doc[i].get_text()} for i in idx if 0 <= i < doc.page_count]}))


def slice_pdf(path, out, idx):
    src = pymupdf.open(path)
    dst = pymupdf.open()
    for i in idx:
        dst.insert_pdf(src, from_page=i, to_page=i)
    dst.save(out, garbage=3, deflate=True)
    print(json.dumps({"bytes": os.path.getsize(out), "pages": dst.page_count}))


def render(path, out_dir, width, idx):
    doc = pymupdf.open(path)
    os.makedirs(out_dir, exist_ok=True)
    for i in idx:
        page = doc[i]
        zoom = width / max(1, page.rect.width)
        pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
        pix.save(os.path.join(out_dir, f"{i}.jpg"), jpg_quality=80)
    print(json.dumps({"ok": True}))


def image(src, out, max_px):
    pix = pymupdf.Pixmap(src)
    if pix.alpha:
        pix = pymupdf.Pixmap(pix, 0)
    if pix.colorspace and pix.colorspace.n not in (1, 3):
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    big = max(pix.width, pix.height)
    if big > max_px:
        # shrink by halves (fast), then let the JPEG stay at most ~2× max_px
        while max(pix.width, pix.height) > max_px * 2:
            pix.shrink(1)
    pix.save(out, jpg_quality=85)
    print(json.dumps({"width": pix.width, "height": pix.height, "bytes": os.path.getsize(out)}))


def main(argv):
    cmd = argv[1] if len(argv) > 1 else ""
    if cmd == "info":
        info(argv[2])
    elif cmd == "text":
        text(argv[2], pages_arg(argv[3]))
    elif cmd == "slice":
        slice_pdf(argv[2], argv[3], pages_arg(argv[4]))
    elif cmd == "render":
        render(argv[2], argv[3], int(argv[4]), pages_arg(argv[5]))
    elif cmd == "image":
        image(argv[2], argv[3], int(argv[4]))
    else:
        print(__doc__, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv))
    except Exception as e:  # one line on stderr: materials.js shows it
        print(f"{type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)
