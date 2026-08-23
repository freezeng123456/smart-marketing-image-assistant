#!/usr/bin/env python3
"""Fit an image into a target aspect-ratio canvas (contain + blurred fill)."""
import sys
from PIL import Image, ImageFilter

def main():
    if len(sys.argv) < 5:
        raise SystemExit("usage: pad-aspect.py in out width height")
    src, out, tw, th = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
    tw = max(64, (tw // 8) * 8)
    th = max(64, (th // 8) * 8)
    im = Image.open(src).convert("RGBA")
    # Blurred cover background so edit models don't keep a square letterbox.
    bg = im.convert("RGB")
    bg_scale = max(tw / bg.width, th / bg.height)
    bg = bg.resize((max(1, int(bg.width * bg_scale)), max(1, int(bg.height * bg_scale))), Image.Resampling.LANCZOS)
    left = max(0, (bg.width - tw) // 2)
    top = max(0, (bg.height - th) // 2)
    bg = bg.crop((left, top, left + tw, top + th)).filter(ImageFilter.GaussianBlur(radius=18))
    canvas = bg.convert("RGBA")
    # Foreground contained and centered
    scale = min(tw / im.width, th / im.height)
    fw = max(1, int(im.width * scale))
    fh = max(1, int(im.height * scale))
    fg = im.resize((fw, fh), Image.Resampling.LANCZOS)
    canvas.paste(fg, ((tw - fw) // 2, (th - fh) // 2), fg)
    canvas.convert("RGB").save(out, format="PNG", optimize=True)

if __name__ == "__main__":
    main()
