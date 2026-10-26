"""Review sheet: every mockup with a full-screen UI (status bar, cards, tab bar) laid out like <DeviceMockup contentWidth=393>.
usage: review_mockups.py library_dir out.png [ids]"""
import json
import os
import sys

from PIL import Image, ImageDraw

lib, out = sys.argv[1], sys.argv[2]
ids = sys.argv[3].split(',') if len(sys.argv) > 3 else [i['id'] for i in json.load(open(f'{lib}/index.json', encoding='utf-8'))]
H = 520  # tile height


def ui(w, h):
    """a 393-wide phone screen scaled to w; its height follows the screen rect like DeviceMockup does"""
    k = w / 393
    im = Image.new('RGBA', (w, h), (246, 246, 250, 255))
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, w, int(54 * k)), fill=(255, 255, 255, 255))
    d.text((int(24 * k), int(18 * k)), '9:41', fill=(0, 0, 0, 255))
    d.rectangle((0, int(54 * k), w, int(110 * k)), fill=(90, 110, 255, 255))
    for i in range(6):
        y = int((126 + i * 112) * k)
        d.rounded_rectangle((int(16 * k), y, w - int(16 * k), y + int(96 * k)), radius=int(16 * k), fill=(255, 255, 255, 255), outline=(220, 220, 230, 255))
    # tab bar pinned to the bottom of an 852-high frame
    tb = int(852 * k)
    d.rectangle((0, tb - int(84 * k), w, tb), fill=(30, 30, 36, 255))
    for i in range(4):
        cx = int((49 + i * 98) * k)
        d.ellipse((cx - int(12 * k), tb - int(62 * k), cx + int(12 * k), tb - int(38 * k)), fill=(180, 219, 71, 255))
    return im


tiles = []
for mid in ids:
    meta = json.load(open(f'{lib}/{mid}/meta.json', encoding='utf-8'))
    dev = Image.open(f'{lib}/{mid}/device.png').convert('RGBA')
    sc = meta['screen']
    canvas = Image.new('RGBA', dev.size, (24, 24, 30, 255))
    content_h = int(sc['w'] * 852 / 393)  # what DeviceMockup lays out
    u = ui(sc['w'], max(content_h, sc['h']))
    m = Image.new('L', (sc['w'], sc['h']), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, sc['w'] - 1, sc['h'] - 1), radius=sc['r'], fill=255)
    canvas.paste(u.crop((0, 0, sc['w'], sc['h'])), (sc['x'], sc['y']), m)
    canvas.alpha_composite(dev)
    k = H / dev.height
    t = canvas.resize((round(dev.width * k), H), Image.LANCZOS).convert('RGB')
    lab = Image.new('RGB', (max(t.width, 150), H + 34), (24, 24, 30))
    lab.paste(t, ((lab.width - t.width) // 2, 34))
    ratio = sc['w'] / sc['h']
    ImageDraw.Draw(lab).text((6, 4), f"{mid}  {sc['w']}x{sc['h']}  r={ratio:.3f}  frame={content_h}", fill=(230, 230, 230))
    ImageDraw.Draw(lab).text((6, 18), f"tab bar {'cut' if content_h > sc['h'] + 4 else 'ok'}", fill=(255, 120, 100) if content_h > sc['h'] + 4 else (160, 220, 120))
    tiles.append(lab)

cols = 7
rows = (len(tiles) + cols - 1) // cols
cw = max(t.width for t in tiles)
sheet = Image.new('RGB', (cw * cols, (H + 34) * rows), (24, 24, 30))
for i, t in enumerate(tiles):
    sheet.paste(t, ((i % cols) * cw, (i // cols) * (H + 34)))
sheet.save(out)
print(sheet.size)
