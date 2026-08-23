#!/usr/bin/env python3
"""Letterbox/pillarbox an image onto a target aspect canvas WITHOUT cropping.

The original pixels are scaled with contain (fit inside) and centered.
Empty margins are filled with a flat matte so edit models can outpaint/expand.
"""
import sys
from PIL import Image

def main():
    if len(sys.argv) < 5:
        raise SystemExit("usage: pad-aspect.py in out width height [matte_hex]")
    src, out, tw, th = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
    matte = (245, 245, 245)
    if len(sys.argv) >= 6:
        hex_color = sys.argv[5].lstrip("#")
        if len(hex_color) == 6:
            matte = tuple(int(hex_color[i : i + 2], 16) for i in (0, 2, 4))
    tw = max(64, (tw // 8) * 8)
    th = max(64, (th // 8) * 8)
    im = Image.open(src).convert("RGBA")
    # Contain: never crop the source.
    scale = min(tw / im.width, th / im.height)
    fw = max(1, int(im.width * scale))
    fh = max(1, int(im.height * scale))
    fg = im.resize((fw, fh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (tw, th), matte)
    canvas.paste(fg, ((tw - fw) // 2, (th - fh) // 2), fg)
    canvas.save(out, format="PNG", optimize=True)

if __name__ == "__main__":
    main()
