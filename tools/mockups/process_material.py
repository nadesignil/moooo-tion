"""Material phone (background removed, pure-green screen) → library mockup, WITHOUT stretching the device.

The screen hole is a rounded rect with exactly the standard screen proportions, the smallest one that covers the
green area (it may cut a little into the material), kept inside the body. Green left outside the hole becomes a
black inner bezel. The Dynamic Island is the standard one, at the standard place relative to the screen.
usage: process_material3.py cutout.png std_dir out_dir
"""
import json
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

src, std_dir, out = sys.argv[1], sys.argv[2], sys.argv[3]
# how far around a frame pill to repaint (its rim, shadow or recess)
PILL_PAD = int(sys.argv[4]) if len(sys.argv) > 4 else 14
STD = json.load(open(f'{std_dir}/meta.json', encoding='utf-8'))
R = STD['screen']['w'] / STD['screen']['h']  # w/h of the standard screen rect

im = Image.open(src).convert('RGBA')
A = np.asarray(im).astype(np.float32)
rgb, alpha = A[..., :3], A[..., 3] / 255.0
r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
spill = g - np.maximum(r, b)
h, w = alpha.shape


def flood(mask_bool, seed):
    m = Image.fromarray(np.where(mask_bool, 255, 0).astype(np.uint8)).copy()
    ImageDraw.floodfill(m, seed, 128)
    return np.asarray(m) == 128


def fill_holes(comp):
    inv = Image.fromarray(np.where(comp, 0, 255).astype(np.uint8)).copy()
    ImageDraw.floodfill(inv, (0, 0), 128)
    return comp | (np.asarray(inv) == 255)


def dilate(mask_bool, rad):
    m = Image.fromarray(np.where(mask_bool, 255, 0).astype(np.uint8)).filter(ImageFilter.MaxFilter(2 * rad + 1))
    return np.asarray(m) > 0


green = (spill > 90) & (g > 150)
ys, xs = np.nonzero(green)
k = np.argmin((xs - w / 2) ** 2 + (ys - h / 2) ** 2)
G = fill_holes(flood(green, (int(xs[k]), int(ys[k]))))
gy, gx = np.nonzero(G)
pad = 3
gx0, gx1, gy0, gy1 = gx.min() - pad, gx.max() + pad, gy.min() - pad, gy.max() + pad
gw, gh = gx1 - gx0, gy1 - gy0
cx, cy = (gx0 + gx1) / 2, (gy0 + gy1) / 2

# the body (opaque cut-out) bounds; the hole stays a margin inside them
body = alpha > 0.9
by, bx = np.nonzero(body)
bx0, bx1, by0, by1 = bx.min(), bx.max(), by.min(), by.max()
margin = 0.035 * (bx1 - bx0)

# smallest standard-proportioned rect that covers the green
if gw / gh < R:
    hw, hh = gh * R, gh
else:
    hw, hh = gw, gw / R
s = min(1.0, (bx1 - bx0 - 2 * margin) / hw, (by1 - by0 - 2 * margin) / hh)
hw, hh = hw * s, hh * s
hx0 = float(np.clip(cx - hw / 2, bx0 + margin, bx1 - margin - hw))
hy0 = float(np.clip(cy - hh / 2, by0 + margin, by1 - margin - hh))
rad = 0.08 * hw

# anti-aliased rounded rect, drawn 4× and scaled down
SS = 4
big = Image.new('L', (w * SS, h * SS), 0)
ImageDraw.Draw(big).rounded_rectangle((hx0 * SS, hy0 * SS, (hx0 + hw) * SS, (hy0 + hh) * SS), radius=rad * SS, fill=255)
hole = np.asarray(big.resize((w, h), Image.LANCZOS)).astype(np.float32) / 255
hole_b = hole > 0.5

# a pill the model drew on the frame above the screen would double the real island: paint it over with the
# frame material from the same rows beside it
def remove_frame_pills(col):
    dark = (rgb.max(-1) < 70) & (alpha > 0.5) & ~hole_b
    top_band = np.zeros_like(dark)
    y_hi = int(hy0 + 0.06 * hw)
    top_band[max(0, int(by0)) : y_hi, int(hx0 + hw * 0.2) : int(hx0 + hw * 0.8)] = True
    cand = dark & top_band
    found = []
    seen = np.zeros_like(cand)
    for y, x in zip(*np.nonzero(cand)):
        if seen[y, x]:
            continue
        comp = flood(cand & ~seen, (int(x), int(y)))
        seen |= comp
        cy_, cx_ = np.nonzero(comp)
        bw_, bh_ = cx_.max() - cx_.min() + 1, cy_.max() - cy_.min() + 1
        if 0.1 * hw < bw_ < 0.5 * hw and bh_ < 0.14 * hw and bw_ > 1.6 * bh_:
            found.append(comp)
    for comp in found:
        # the pill with its rim and shadow; filled from the same rows of the frame left and right of it
        m = dilate(comp, PILL_PAD)
        ys_, xs_ = np.nonzero(m)
        x0, x1, y0, y1 = xs_.min(), xs_.max() + 1, ys_.min(), ys_.max() + 1
        mw = x1 - x0
        left = col[y0:y1, max(0, x0 - mw - 10) : max(0, x0 - mw - 10) + mw]
        right = col[y0:y1, min(w - mw, x1 + 10) : min(w - mw, x1 + 10) + mw]
        if left.shape[1] != mw or right.shape[1] != mw:
            continue
        fill = col.copy()
        fill[y0:y1, x0:x1] = (left + right) / 2
        soft = np.asarray(Image.fromarray(np.where(m, 255, 0).astype(np.uint8)).filter(ImageFilter.GaussianBlur(5))).astype(np.float32)[..., None] / 255
        col = col * (1 - soft) + fill * soft
    return col, len(found)


col0, pills = remove_frame_pills(rgb.copy())
rgb = col0
r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]

# green that the hole does not cover → black glass bezel; despill what is left around
near = dilate(G, 14)
greenness = np.clip(spill / 160.0, 0, 1)
bezel = near & ~hole_b & (greenness > 0.05)
col = rgb.copy()
dark = np.array([10, 10, 12], np.float32)
col = np.where(bezel[..., None], col * (1 - greenness[..., None]) + dark * greenness[..., None], col)
wide = dilate(G, 22)
cr, cg, cb = col[..., 0], col[..., 1], col[..., 2]
cg = np.where(wide, np.minimum(cg, (cr + cb) / 2 + 4), cg)
col = np.dstack([cr, cg, cb])

# inner shadow on the material around the screen
ring = dilate(hole_b, 5) & ~hole_b
shade = np.asarray(Image.fromarray(np.where(ring, 255, 0).astype(np.uint8)).filter(ImageFilter.GaussianBlur(3))).astype(np.float32) / 255
col = col * (1 - 0.4 * shade[..., None])

new_alpha = alpha * (1 - hole)
dev = Image.fromarray(np.dstack([np.clip(col, 0, 255), np.clip(new_alpha * 255, 0, 255)]).astype(np.uint8), 'RGBA')

# the standard Dynamic Island, scaled to this screen
std = Image.open(f'{std_dir}/device.png').convert('RGBA')
ss = STD['screen']
ibox = (629 - 4, 115 - 4, 1081 + 5, 245 + 5)  # island in the standard device (measured)
isl = std.crop(ibox)
f = hw / ss['w']
isl = isl.resize((max(1, round(isl.width * f)), max(1, round(isl.height * f))), Image.LANCZOS)
ix = round(hx0 + hw / 2 - isl.width / 2)
iy = round(hy0 + (ibox[1] - ss['y']) * f)
dev.alpha_composite(isl, (ix, iy))

p = 12
crop = (max(0, bx0 - p), max(0, by0 - p), min(w, bx1 + p), min(h, by1 + p))
dev = dev.crop(crop)
dev.save(f'{out}/device.png', optimize=True)
rect = {'x': round(hx0 - crop[0]), 'y': round(hy0 - crop[1]), 'w': round(hw), 'h': round(hh), 'r': round(rad)}
# light-screen thumbnail for the picker
th = Image.new('RGBA', dev.size, (0, 0, 0, 0))
ImageDraw.Draw(th).rounded_rectangle((rect['x'], rect['y'], rect['x'] + rect['w'], rect['y'] + rect['h']), radius=rect['r'], fill=(232, 233, 238, 255))
th.alpha_composite(dev)
th.thumbnail((240, 480), Image.LANCZOS)
th.save(f'{out}/thumb.png', optimize=True)
print(json.dumps({'size': list(dev.size), 'screen': rect, 'green_ratio': round(gw / gh, 3), 'shrunk': round(s, 3), 'pills': pills}))
