#!/usr/bin/env python3
"""Draw the dark backgrounds of our pitch art: Dark, Slate and Floodlit grass.

Every pitch we draw is grey ink on white paper, and every dark version is the
same drawing on other paper, so the lines sit exactly where pitches.ts
measured them on the light one and the surface, snap lines and scoreboard
column are shared by all four.

  dark   the paper and ink exchanged: the drawing as a negative
  slate  flat cool charcoal, markings in crisp white, the zone grid kept faint
  grass  mown bands under floodlights, markings in chalk, the grid kept quiet

The ink amount a = (255 - L) / 255 tells the drawing apart: the dashed grid is
about 0.2, the solid markings about 0.34. Slate and grass weigh them apart, so
the markings lead and the grid stays behind them.

The Tactics Journal mark is not part of the pitch and is drawn the way
tacticsjournal.com shows it in dark mode: the book filled white inside its own
outline, which keeps its own ink, with nothing behind it; the
tacticsjournal.com wordmark set in white.

PAPER must match PITCH_PAPER in src/pitches.ts: the board paints that colour
behind the art while it loads.

Needs Pillow and numpy. Run after any light pitch changes:
  python3 scripts/make-dark-pitches.py
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
PITCH = ROOT / 'assets/pitch'

# source art, and which way its length runs (the mown bands go across it)
ART = {
    'pitch_marked.jpeg': 'h',
    'pitch_up_marked.jpeg': 'v',
    'full_pitch_marked.png': 'v',
    'training_marked.jpeg': 'h',
    'sidebyside_marked.jpeg': 'side',
    'pitch.jpeg': 'h',
}
# The training mark is a grey watermark, so it is found by where it is rather
# than by its colour: (x0, y0, x1, y1) as fractions of the art, and which part.
GREY_MARKS = {
    'training_marked.jpeg': [((0.44, 0.39, 0.56, 0.59), 'book'), ((0.80, 0.895, 0.955, 0.94), 'word')],
}
# An 800-wide board exports at 2048 pixels; more than that is only weight.
MAX_W = 2048

PAPER = {'dark': (27, 28, 31), 'slate': (27, 30, 36), 'grass': (23, 54, 38)}
INK = {'dark': (245, 245, 247), 'slate': (232, 235, 240), 'grass': (236, 242, 236)}
GRASS_BANDS = ((24, 58, 41), (21, 51, 36))
WHITE = np.array((255, 255, 255), float)


def weight(a):
    """Ink amount on white -> line opacity on dark: grid ~0.3, markings ~0.88."""
    return np.interp(a, [0.0, 0.06, 0.22, 0.30, 0.36, 1.0], [0.0, 0.05, 0.30, 0.62, 0.88, 1.0])


def bands(h, w, layout, n=14):
    if layout == 'v':
        m = np.repeat(((np.arange(h) * n // h) % 2)[:, None], w, axis=1)
    elif layout == 'side':
        half = w // 2
        m = np.repeat(((np.arange(w) % half) * (n // 2) // half % 2)[None, :], h, axis=0)
    else:
        m = np.repeat(((np.arange(w) * n // w) % 2)[None, :], h, axis=0)
    c1, c2 = (np.array(c, float) for c in GRASS_BANDS)
    return np.where(m[..., None] == 0, c1, c2)


def vignette(h, w, strength):
    y, x = np.mgrid[0:h, 0:w]
    d = np.sqrt(((x - w / 2) / (w / 2)) ** 2 + ((y - h / 2) / (h / 2)) ** 2) / np.sqrt(2)
    return (1 - strength * d ** 2)[..., None]


def surface(paper, h, w, layout):
    if paper == 'grass':
        return bands(h, w, layout) * vignette(h, w, 0.35)
    if paper == 'slate':
        return np.full((h, w, 3), PAPER['slate'], float) * vignette(h, w, 0.12)
    return np.full((h, w, 3), PAPER['dark'], float)


def rows_of(mask):
    """Split the mark into its rows of ink: the book, and the wordmark."""
    rows = np.nonzero(mask.any(1))[0]
    out, start = [], rows[0]
    for a, b in zip(rows, rows[1:]):
        if b - a > 6:
            out.append((start, a))
            start = b
    out.append((start, rows[-1]))
    return out


def inside(L, box):
    """Whatever the book's outline encloses: the paper is flooded in from the
    edge of its box, and what the flood cannot reach is the book."""
    ys, xs = box
    crop = Image.fromarray(np.where(L[ys, xs] < 215, 0, 255).astype('uint8'))
    padded = Image.new('L', (crop.width + 2, crop.height + 2), 255)
    padded.paste(crop, (1, 1))
    ImageDraw.floodfill(padded, (0, 0), 128)
    full = np.zeros(L.shape, bool)
    full[ys, xs] = np.asarray(padded, int)[1:-1, 1:-1] != 128
    return full


def dark_name(name: str, paper: str) -> str:
    return f'{name.rpartition(".")[0]}_{paper}.jpg'


for name, layout in ART.items():
    src = Image.open(PITCH / name).convert('L')
    scale = min(1.0, MAX_W / src.width)
    L = np.asarray(src.resize((round(src.width * scale), round(src.height * scale)), Image.LANCZOS) if scale < 1 else src, float)
    h, w = L.shape

    book = np.zeros((h, w), bool)
    pages = np.zeros((h, w), bool)
    word = np.zeros((h, w), bool)
    book_ink = 0.0
    black = np.asarray(src, float) < 70
    black[:12, :] = black[-12:, :] = False   # stray dark pixels on the art's edge are not the mark
    black[:, :12] = black[:, -12:] = False
    if black.any():
        parts = rows_of(black)
        tallest = max(b - a for a, b in parts)
        for y0, y1 in parts:
            xs = np.nonzero(black[y0:y1 + 1].any(0))[0]
            box = (slice(max(0, int(y0 * scale) - 2), int(y1 * scale) + 3),
                   slice(max(0, int(xs.min() * scale) - 2), int(xs.max() * scale) + 3))
            if (y1 - y0) < 0.4 * tallest:
                word[box] = True
            else:
                book[box] = True
                pages |= inside(L, box)
    for (fx0, fy0, fx1, fy1), part in GREY_MARKS.get(name, []):
        box = (slice(int(fy0 * h), int(fy1 * h)), slice(int(fx0 * w), int(fx1 * w)))
        if part == 'book':
            book[box] = True
            pages |= inside(L, box)
            book_ink = 169.0
        else:
            word[box] = True

    mark = book | word
    a = np.where(mark, 0, (255 - L) / 255)
    for paper in PAPER:
        under = surface(paper, h, w, layout)
        ink = np.array(INK[paper], float)
        if paper == 'dark':
            out = under + a[..., None] * (ink - under)
        else:
            o = weight(a)[..., None]
            out = under * (1 - o) + ink * o
            # a breath of noise, so the gradient never bands
            out += np.random.default_rng(1).uniform(-1.0, 1.0, out.shape)
        ink_alpha = np.clip((255 - L) / (255 - book_ink), 0, 1)[..., None]
        fill = np.where(pages[..., None], WHITE, under)
        out = np.where(book[..., None], fill * (1 - ink_alpha) + book_ink * ink_alpha, out)
        if word.any():
            word_alpha = np.clip((255 - L) / (255 - L[word].min()), 0, 1)[..., None]
            out = np.where(word[..., None], under * (1 - word_alpha) + WHITE * word_alpha, out)
        target = PITCH / dark_name(name, paper)
        Image.fromarray(np.clip(out, 0, 255).astype('uint8')).save(target, quality=88, optimize=True)
        print(f'wrote {target.relative_to(ROOT)}')
