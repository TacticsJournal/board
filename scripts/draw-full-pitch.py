#!/usr/bin/env python3
"""Draw assets/pitch/full_pitch_marked.png: a whole pitch stood up, composed
for a 3:4-safe board.

The board is 800 x 1066 board units (a hair wider than 3:4), so a social export
of it is never cropped top and bottom. The pitch is laid out from those units:
68m of width fills the 800, 105m of length fills the 1066, and every marking is
placed off the real dimensions, so both penalty areas, both goal areas and both
arcs sit whole inside the frame. Lines keep the house look: pale grey solids,
lighter dashed grid, the black Tactics Journal mark in the top-left corner
lifted from the previous drawing so the branding is unchanged.

Run: python3 scripts/draw-full-pitch.py
"""
from math import acos, degrees
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / 'assets/brand/full-pitch-brand.png'
OUTPUT = ROOT / 'assets/pitch/full_pitch_marked.png'

W, H = 800, 1066            # board units
PX = 5                      # output pixels per board unit -> 4000 x 5330
SS = 2                      # supersampling while drawing

SX = W / 68.0               # units per metre across the pitch
SY = H / 105.0              # units per metre along it

SOLID = (169, 169, 169)
DASHED = (200, 200, 200)
BLACK = (0, 0, 0)
SOLID_W = 3.4
DASH_W = 2.8
DASH, GAP = 9.2, 8.4

CX = W / 2
HALFWAY = H / 2

BOX_X0, BOX_X1 = CX - 40.32 / 2 * SX, CX + 40.32 / 2 * SX      # penalty area
BOX_D = 16.5 * SY
GOAL_X0, GOAL_X1 = CX - 18.32 / 2 * SX, CX + 18.32 / 2 * SX    # goal area
GOAL_D = 5.5 * SY
SPOT = 11.0 * SY
R = 9.15 * SX                                                   # circle / arc

BOX_TOP, BOX_BOT = BOX_D, H - BOX_D
GOAL_TOP, GOAL_BOT = GOAL_D, H - GOAL_D
GRID_TOP, GRID_BOT = (BOX_TOP + HALFWAY) / 2, (HALFWAY + BOX_BOT) / 2

s = lambda v: v * PX * SS
img = Image.new('RGB', (W * PX * SS, H * PX * SS), 'white')
d = ImageDraw.Draw(img)


def line(x0, y0, x1, y1, colour=SOLID, width=SOLID_W):
    d.line([s(x0), s(y0), s(x1), s(y1)], fill=colour, width=round(s(width)))


def dashed(x0, y0, x1, y1):
    """A dashed run, centred on the middle of the span so both ends match."""
    span = max(abs(x1 - x0), abs(y1 - y0))
    period = DASH + GAP
    n = max(1, round((span + GAP) / period))
    start = (span - (n * period - GAP)) / 2
    ux, uy = (x1 - x0) / span, (y1 - y0) / span
    for i in range(n):
        a = start + i * period
        b = min(span, a + DASH)
        if b <= 0:
            continue
        a = max(0.0, a)
        line(x0 + ux * a, y0 + uy * a, x0 + ux * b, y0 + uy * b, DASHED, DASH_W)


def arc(cx, cy, r, start, end, width=SOLID_W):
    w = round(s(width))
    d.arc([s(cx - r), s(cy - r), s(cx + r), s(cy + r)], start, end, fill=SOLID, width=w)


# --- halfway line, centre circle, centre spot ---------------------------------
line(0, HALFWAY, W, HALFWAY)
d.ellipse([s(CX - R), s(HALFWAY - R), s(CX + R), s(HALFWAY + R)],
          outline=SOLID, width=round(s(SOLID_W)))
d.ellipse([s(CX - 3.2), s(HALFWAY - 3.2), s(CX + 3.2), s(HALFWAY + 3.2)], fill=SOLID)

# --- both ends: penalty area, goal area, penalty arc --------------------------
for top in (True, False):
    box_y = BOX_TOP if top else BOX_BOT
    goal_y = GOAL_TOP if top else GOAL_BOT
    end_y = 0 if top else H
    spot_y = SPOT if top else H - SPOT
    line(BOX_X0, box_y, BOX_X1, box_y)
    line(BOX_X0, end_y, BOX_X0, box_y)
    line(BOX_X1, end_y, BOX_X1, box_y)
    line(GOAL_X0, goal_y, GOAL_X1, goal_y)
    line(GOAL_X0, end_y, GOAL_X0, goal_y)
    line(GOAL_X1, end_y, GOAL_X1, goal_y)
    # the arc, only the part of it that lies outside the penalty area: the
    # sweep either side of straight-down (straight-up at the far end) that
    # clears the box line
    half = degrees(acos(min(1.0, abs(box_y - spot_y) / R)))
    mid = 90 if top else 270
    arc(CX, spot_y, R, mid - half, mid + half)

# --- dashed tactical grid -----------------------------------------------------
for y in (BOX_TOP, BOX_BOT):          # the box line, carried on to both touchlines
    dashed(0, y, BOX_X0, y)
    dashed(BOX_X1, y, W, y)
for y in (GRID_TOP, GRID_BOT):        # midway between the box line and halfway
    dashed(0, y, W, y)
for x in (BOX_X0, BOX_X1, GOAL_X0, GOAL_X1):
    dashed(x, BOX_TOP, x, BOX_BOT)

img = img.resize((W * PX, H * PX), Image.LANCZOS)

# --- branding: the same high-resolution mark at the same board coordinates ----
brand = Image.open(BRAND).convert('RGB')
img.paste(brand, (15 * PX, 33 * PX))

img.save(OUTPUT, optimize=True)
print(img.size, 'aspect', round(img.size[0] / img.size[1], 4))
print('box', round(BOX_X0, 1), round(BOX_X1, 1), 'depth', round(BOX_TOP, 1))
print('goal area', round(GOAL_X0, 1), round(GOAL_X1, 1), 'depth', round(GOAL_TOP, 1))
print('spot', round(SPOT, 1), 'R', round(R, 1), 'grid y', round(GRID_TOP, 1), round(GRID_BOT, 1))
