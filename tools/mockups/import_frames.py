"""Mockup frames drawn as a bezel only (the screen hole is already transparent) → library/mockups/<id>/.

usage: import_frames.py frames.json library_dir
frames.json: [{"id": "...", "title": "...", "file": "path/to/frame.png", "material": "...", "source": "..."}]

The screen rect keeps the standard iPhone proportions (contentWidth 393 → 852 like the standard mockup): it covers
the hole and reaches under the bezel where the hole is narrower, so the UI is never squashed. Its corner radius
covers the hole's inner corner.
"""
import json
import math
import os
import sys

import cv2
import numpy as np
from PIL import Image

RATIO = 1577 / 3403  # the standard mockup's screen
PAD = 6

frames_json, lib = sys.argv[1], sys.argv[2]
frames = json.load(open(frames_json, encoding='utf-8'))


def corner_radius(hole, x0, y0, x1, y1):
    """the inner corner radius from how far the hole's corner is cut along each diagonal"""
    rs = []
    for cx, cy, dx, dy in ((x0, y0, 1, 1), (x1, y0, -1, 1), (x0, y1, 1, -1), (x1, y1, -1, -1)):
        t = 0
        while t < 400 and not hole[cy + dy * t, cx + dx * t]:
            t += 1
        rs.append(t / (1 - 1 / math.sqrt(2)))
    return float(np.median(rs))


report = []
for f in frames:
    im = Image.open(f['file']).convert('RGBA')
    a = np.array(im.getchannel('A'))
    ys, xs = np.where(a > 8)
    box = (max(0, xs.min() - PAD), max(0, ys.min() - PAD), min(im.width, xs.max() + PAD + 1), min(im.height, ys.max() + PAD + 1))
    im = im.crop(box)
    a = np.array(im.getchannel('A'))
    h, w = a.shape
    # the hole: transparent pixels connected to the middle of the device. An ornamental frame (tribal, thorns)
    # has gaps — close them a little more each try until the fill no longer leaks out to the image edge
    for k in range(0, 80, 4):
        solid = (a >= 128).astype(np.uint8)
        if k:
            solid = cv2.morphologyEx(solid, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k + 1, k + 1)))
        clear = (1 - solid).astype(np.uint8)
        mask = np.zeros((h + 2, w + 2), np.uint8)
        cv2.floodFill(clear, mask, (w // 2, h // 2), 2)
        hole = clear == 2
        if not (hole[0].any() or hole[-1].any() or hole[:, 0].any() or hole[:, -1].any()):
            break
    else:
        raise SystemExit(f"{f['id']}: the frame is open, no screen hole")
    if k:
        print(f"{f['id']}: gaps closed with a {k + 1}px kernel")
    hy, hx = np.where(hole)
    x0, x1, y0, y1 = hx.min(), hx.max(), hy.min(), hy.max()
    hw, hh = x1 - x0 + 1, y1 - y0 + 1
    r = corner_radius(hole, x0, y0, x1, y1)
    cx, cy = (x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2
    # standard proportions, covering the hole
    if hw / hh > RATIO:
        sw, sh = hw, hw / RATIO
    else:
        sw, sh = hh * RATIO, hh
    # a hair under the bezel all round: no background seam at the hole's soft edge
    sw, sh = sw + 4, sh + 4 * sh / sw
    screen = {'x': round(cx - sw / 2), 'y': round(cy - sh / 2), 'w': round(sw), 'h': round(sh), 'r': round(r + 2)}
    # ornamental frames (vines across the screen, spikes into it): the inner edge of the phone rail, measured by eye
    # as {x, y, w, h, r} in the cropped device.png — the screen keeps the standard proportions around it
    if f.get('screen'):
        g = f['screen']
        gx, gy = g['x'] + g['w'] / 2, g['y'] + g['h'] / 2
        sw, sh = (g['w'], g['w'] / RATIO) if g['w'] / g['h'] > RATIO else (g['h'] * RATIO, g['h'])
        sw, sh = sw + 4, sh + 4 * sh / sw
        hw, hh = g['w'], g['h']
        screen = {'x': round(gx - sw / 2), 'y': round(gy - sh / 2), 'w': round(sw), 'h': round(sh), 'r': g['r']}

    # the frames come without the Dynamic Island: draw the standard one (125×37 pt at 11 pt on a 393 pt screen)
    if not f.get('noIsland'):
        k = screen['w'] / 393
        ss = 4
        pill = Image.new('L', (w * ss, h * ss), 0)
        from PIL import ImageDraw
        iw, ih = 125 * k * ss, 37 * k * ss
        px, py = screen['x'] * ss + (screen['w'] * ss - iw) / 2, screen['y'] * ss + 11 * k * ss
        ImageDraw.Draw(pill).rounded_rectangle((px, py, px + iw, py + ih), radius=ih / 2, fill=255)
        pill = pill.resize((w, h), Image.LANCZOS)
        # under the frame: vines and ornaments that cross the screen stay on top of the island
        island = Image.new('RGBA', (w, h), (0, 0, 0, 255))
        island.putalpha(pill)
        island.alpha_composite(im)
        im = island

    out = os.path.join(lib, f['id'])
    os.makedirs(out, exist_ok=True)
    im.save(os.path.join(out, 'device.png'), optimize=True)
    th = im.copy()
    th.thumbnail((10_000, 480), Image.LANCZOS)
    th.save(os.path.join(out, 'thumb.png'), optimize=True)
    meta = {
        'id': f['id'],
        'title': f['title'],
        'material': f.get('material', ''),
        'device': 'iPhone 17 Air',
        'size': [w, h],
        'screen': screen,
        'source': f.get('source', ''),
        'note': 'Рамка без экрана: дыра уже прозрачная. Прямоугольник экрана — стандартных пропорций, накрывает дыру и заходит под рамку.',
    }
    json.dump(meta, open(os.path.join(out, 'meta.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    report.append(f"{f['id']:14} device {w}x{h}  hole {hw}x{hh} ({hw / hh:.3f})  screen {screen['w']}x{screen['h']} r{screen['r']}  "
                  f"under bezel: {max(0, (screen['w'] - hw) / 2):.0f}px sides, {max(0, (screen['h'] - hh) / 2):.0f}px top/bottom")

print('\n'.join(report))
