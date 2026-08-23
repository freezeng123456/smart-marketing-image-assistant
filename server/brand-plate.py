#!/usr/bin/env python3
"""Place brand kangaroo on a bright warm marketing plate for img2img."""
from PIL import Image, ImageDraw
import sys

brand_path, out, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
size = max(512, min(1280, size))
canvas = Image.new("RGB", (size, size))
draw = ImageDraw.Draw(canvas)
for y in range(size):
    t = y / max(1, size - 1)
    r = int(255 - 20 * t)
    g = int(140 + 70 * t)
    b = int(30 + 20 * t)
    draw.line([(0, y), (size, y)], fill=(r, g, b))
cx, cy = size // 2, int(size * 0.55)
base = canvas.convert("RGBA")
for rad in range(size // 2, 0, -8):
    alpha = max(0, 90 - rad * 90 // (size // 2))
    if alpha <= 0:
        continue
    overlay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=(255, 220, 120, alpha))
    base = Image.alpha_composite(base, overlay)
brand = Image.open(brand_path).convert("RGBA")
bw, bh = brand.size
scale = min((size * 0.78) / bw, (size * 0.82) / bh)
nw, nh = max(1, int(bw * scale)), max(1, int(bh * scale))
brand = brand.resize((nw, nh), Image.Resampling.LANCZOS)
px = brand.load()
for yy in range(nh):
    for xx in range(nw):
        r, g, b, a = px[xx, yy]
        if a > 0 and r > 245 and g > 245 and b > 245:
            px[xx, yy] = (r, g, b, 0)
x = (size - nw) // 2
y = size - nh - int(size * 0.06)
base.paste(brand, (x, y), brand)
base.convert("RGB").save(out, "PNG", optimize=True)
