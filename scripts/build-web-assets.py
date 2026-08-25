"""Regenerate the small runtime copies in assets/web from the 4096px masters.

Usage: python3 scripts/build-web-assets.py  (requires Pillow)
"""
from PIL import Image
import os

JOBS = {
    'assets/ball/ball.png': ('assets/web/ball.png', 256),
    'assets/players/player.png': ('assets/web/player.png', 256),
    'assets/arrows/arrow-solid.png': ('assets/web/arrow-solid.png', 256),
    'assets/arrows/arrow-dashed.png': ('assets/web/arrow-dashed.png', 256),
    'assets/arrows/arrow-dotted.png': ('assets/web/arrow-dotted.png', 256),
    'assets/icons/line.png': ('assets/web/icon-line.png', 128),
    'assets/icons/box.png': ('assets/web/icon-box.png', 128),
    'assets/icons/circle.png': ('assets/web/icon-circle.png', 128),
    'assets/icons/bold_text.png': ('assets/web/icon-bold-text.png', 128),
    'assets/icons/light_text.png': ('assets/web/icon-light-text.png', 128),
}

os.makedirs('assets/web', exist_ok=True)
for src, (dst, size) in JOBS.items():
    im = Image.open(src).convert('RGBA')
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    im.thumbnail((size, size), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(im, ((size - im.width) // 2, (size - im.height) // 2))
    canvas.save(dst, optimize=True)
    print(dst, os.path.getsize(dst) // 1024, 'kB')
