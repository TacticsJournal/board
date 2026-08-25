#!/usr/bin/env python3
"""Synthetic broadcast frame for verify-import.mjs: green pitch with white
lines, 11 white + 11 red player blobs (taller than wide, like real players),
written to /tmp/tbm-screenshot.png. Deterministic (seeded)."""
import random
from PIL import Image, ImageDraw

W, H = 1280, 720
PITCH = (40, 30, 1240, 690)  # corners clicked by the test
GREEN = (34, 139, 34)
WHITE_KIT = (245, 245, 245)
RED_KIT = (200, 30, 30)
BLOB_W, BLOB_H = 14, 26  # players read taller than wide
MIN_DIST = 60

random.seed(2)
im = Image.new('RGB', (W, H), (20, 20, 24))
d = ImageDraw.Draw(im)

x0, y0, x1, y1 = PITCH
d.rectangle(PITCH, fill=GREEN)
# pitch lines
d.rectangle(PITCH, outline=(255, 255, 255), width=3)
cx = (x0 + x1) // 2
d.line([(cx, y0), (cx, y1)], fill=(255, 255, 255), width=3)
d.ellipse([cx - 70, (y0 + y1) // 2 - 70, cx + 70, (y0 + y1) // 2 + 70], outline=(255, 255, 255), width=3)
for bx in (x0, x1 - 180):
    d.rectangle([bx, (y0 + y1) // 2 - 130, bx + 180, (y0 + y1) // 2 + 130], outline=(255, 255, 255), width=3)

pts = []
def place():
    while True:
        x = random.randint(x0 + 40, x1 - 40)
        y = random.randint(y0 + 40, y1 - 40)
        if all((x - px) ** 2 + (y - py) ** 2 >= MIN_DIST ** 2 for px, py in pts):
            pts.append((x, y))
            return x, y

for color in (WHITE_KIT, RED_KIT):
    for _ in range(11):
        x, y = place()
        d.ellipse([x - BLOB_W // 2, y - BLOB_H // 2, x + BLOB_W // 2, y + BLOB_H // 2], fill=color)

im.save('/tmp/tbm-screenshot.png')
print(f'wrote /tmp/tbm-screenshot.png with {len(pts)} players')
