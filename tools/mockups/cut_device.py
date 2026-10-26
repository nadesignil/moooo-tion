"""Cut the iPhone 17 Air Figma export into a device PNG with a transparent screen.

Outside the body: the frame's flat fill (246,245,248) becomes transparent, edges get alpha from the
colour distance. The screen: near-white region connected to the screen centre, holes filled (text,
island), edge alpha from the black bezel. The dynamic island stays opaque on top of the screen.
usage: cut_device.py export.png out_dir
"""
import json
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGBA')
A = np.asarray(im).astype(np.float32)
h, w, _ = A.shape
rgb = A[..., :3]
BG = np.array([246, 245, 248], np.float32)


def flood(mask_bool, seeds):
    """connected component of mask_bool reachable from seeds (4-connected via PIL floodfill)"""
    m = Image.fromarray(np.where(mask_bool, 255, 0).astype(np.uint8)).copy()
    for s in seeds:
        if m.getpixel(s) == 255:
            ImageDraw.floodfill(m, s, 128)
    return np.asarray(m) == 128


def fill_holes(comp):
    inv = Image.fromarray(np.where(comp, 0, 255).astype(np.uint8)).copy()
    ImageDraw.floodfill(inv, (0, 0), 128)
    return comp | (np.asarray(inv) == 255)


def dilate(mask_bool, r):
    m = Image.fromarray(np.where(mask_bool, 255, 0).astype(np.uint8)).filter(ImageFilter.MaxFilter(2 * r + 1))
    return np.asarray(m) > 0


# ── outside: flat background connected to the image border ──
diff = np.abs(rgb - BG).sum(-1)
outside = flood(diff <= 8, [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)])
body = ~outside
band = body & dilate(outside, 1)
# full-coverage reference: the strongest colour distance nearby (the rim itself)
ref = np.asarray(Image.fromarray(np.clip(diff, 0, 765).astype(np.float32)).filter(ImageFilter.MaxFilter(7)))
alpha = np.where(body, 1.0, 0.0).astype(np.float32)
a_band = np.clip(diff / np.maximum(ref, 1), 0, 1)
alpha = np.where(band, a_band, alpha)
color = rgb.copy()
ab = np.maximum(alpha, 1e-3)[..., None]
color = np.where(band[..., None], (rgb - (1 - ab) * BG) / ab, color)

# ── screen: white connected to the centre, holes filled ──
white = rgb.min(-1) > 250
cy, cx = int(h * 0.55), w // 4
seed = next((x, y) for y in range(cy, h) for x in [cx] if white[y, x])
screen_core = fill_holes(flood(white, [seed]))
# the island is a hole in the white component — find it and keep it opaque
dark = rgb.max(-1) < 90
island_seed = (w // 2, next(y for y in range(0, h // 6) if screen_core[y, w // 2]) + 60)
island = fill_holes(flood(dark & screen_core, [island_seed]))
ys, xs = np.nonzero(island)
island_box = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]

# screen edge: anti-aliased between white (screen) and near-black (bezel)
edge = dilate(screen_core, 4) & ~screen_core
lum = rgb.min(-1) / 255.0  # 1 = white screen, ~0 = bezel
s_cov = np.clip(lum, 0, 1)
alpha = np.where(screen_core, 0.0, alpha)
alpha = np.where(edge, np.minimum(alpha, 1 - s_cov), alpha)
ae = np.maximum(1 - s_cov, 1e-3)[..., None]
color = np.where(edge[..., None], np.clip((rgb - s_cov[..., None] * 255) / ae, 0, 255), color)
# island edge is anti-aliased against white too
island_edge = dilate(island, 2) & ~island & screen_core
alpha = np.where(island, 1.0, alpha)
color = np.where(island[..., None], rgb, color)
alpha = np.where(island_edge, 1 - s_cov, alpha)
color = np.where(island_edge[..., None], np.clip((rgb - s_cov[..., None] * 255) / ae, 0, 255), color)

outA = np.dstack([np.clip(color, 0, 255), np.clip(alpha * 255, 0, 255)]).astype(np.uint8)
Image.fromarray(outA, 'RGBA').save(f'{out}/device.png', optimize=True)

ys, xs = np.nonzero(screen_core)
screen = {'x': int(xs.min()), 'y': int(ys.min()), 'w': int(xs.max() - xs.min() + 1), 'h': int(ys.max() - ys.min() + 1)}
# corner: how far in from the left the top row of the screen starts
top = np.nonzero(screen_core[screen['y'] + 1])[0]
print(json.dumps({'size': [w, h], 'screen': screen, 'cornerInset': int(top.min() - screen['x']), 'island': island_box}))
