#!/usr/bin/env python3
"""Derive the dark pitch art from the light art.

Every pitch we draw is grey ink on white paper, so its dark version is the same
drawing with the paper and the ink exchanged: white becomes the dark paper,
black becomes the light ink, and every grey in between keeps its place on the
line between them. Deriving it, rather than drawing it again, is what keeps a
dark board's lines exactly where pitches.ts measured the light one's, so the
surface, the snap lines and the scoreboard column are shared by both.

PAPER must match PITCH_PAPER.dark in src/pitches.ts: the board paints that
colour behind the art while it loads.

Run after any light pitch changes: python3 scripts/make-dark-pitches.py
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PITCH = ROOT / 'assets/pitch'

PAPER = (27, 28, 31)        # #1b1c1f
INK = (245, 245, 247)       # #f5f5f7

ART = [
    'pitch_marked.jpeg',
    'pitch_up_marked.jpeg',
    'full_pitch_marked.png',
    'training_marked.jpeg',
    'sidebyside_marked.jpeg',
    'pitch.jpeg',
]


def ramp(paper: int, ink: int) -> list[int]:
    """One channel's table: 255 (white paper) -> paper, 0 (black ink) -> ink."""
    return [round(paper + (255 - v) / 255 * (ink - paper)) for v in range(256)]


TABLE = ramp(PAPER[0], INK[0]) + ramp(PAPER[1], INK[1]) + ramp(PAPER[2], INK[2])


def dark_name(name: str) -> str:
    stem, dot, ext = name.rpartition('.')
    return f'{stem}_dark{dot}{ext}'


for name in ART:
    out = PITCH / dark_name(name)
    img = Image.open(PITCH / name).convert('RGB').point(TABLE)
    if out.suffix == '.png':
        # A handful of greys is all the drawing has; a palette keeps it small.
        img.quantize(64, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(out, optimize=True)
    else:
        img.save(out, quality=90, optimize=True, subsampling=0)
    print(f'wrote {out.relative_to(ROOT)}')

# The mark the board draws itself, where the art has none baked in: the same
# black drawing as light ink, its transparency untouched.
logo = Image.open(ROOT / 'assets/brand/tj-logo.png').convert('RGBA')
r, g, b, a = logo.split()
rgb = Image.merge('RGB', (r, g, b)).point(TABLE)
light = Image.merge('RGBA', (*rgb.split(), a))
light.save(ROOT / 'assets/brand/tj-logo-light.png', optimize=True)
print('wrote assets/brand/tj-logo-light.png')
