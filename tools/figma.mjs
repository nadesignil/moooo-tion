#!/usr/bin/env node
// Figma REST helper for the studio agent. Token: env FIGMA_TOKEN (set in studio settings).
//
//   node tools/figma.mjs help
//   node tools/figma.mjs meta   <figma-url|fileKey> [nodeId] [--depth 4] [--out file.json]
//   node tools/figma.mjs render <figma-url|fileKey> <nodeId...> [--scale 2] [--format png|jpg|svg] --out <dir>
//   node tools/figma.mjs fills  <figma-url|fileKey> <imageRef...> --out <dir>
//
// meta prints a compact tree: id, type, name, box (x,y,w,h relative to the page), text, fills, radius,
// font style, effects, imageRefs. render exports nodes in isolation (PNG keeps transparency).
import fs from 'node:fs/promises';
import path from 'node:path';

const API = 'https://api.figma.com/v1';
const token = process.env.FIGMA_TOKEN;

const args = process.argv.slice(2);
const cmd = args.shift();
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};

const parse = (s) => {
  const m = String(s).match(/figma\.com\/(?:design|file|proto|board)\/([A-Za-z0-9]+)/);
  const key = m ? m[1] : s;
  const n = String(s).match(/node-id=([0-9]+[-:][0-9]+)/);
  return {key, node: n ? n[1].replace('-', ':') : null};
};

const get = async (url) => {
  if (!token) throw new Error('Нет FIGMA_TOKEN: попросите пользователя добавить токен Figma в настройках студии');
  const res = await fetch(url, {headers: {'X-Figma-Token': token}});
  if (!res.ok) throw new Error(`Figma ${res.status}: ${await res.text()}`);
  return res.json();
};

const color = (c, a = 1) =>
  '#' + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('') + (a < 1 ? ` @${a.toFixed(2)}` : '');

const compact = (n, origin) => {
  const b = n.absoluteBoundingBox;
  const o = {id: n.id, type: n.type, name: n.name};
  if (b) o.box = [Math.round(b.x - origin.x), Math.round(b.y - origin.y), Math.round(b.width), Math.round(b.height)];
  if (n.rotation) o.rotation = Math.round((n.rotation * 180) / Math.PI * 10) / 10;
  if (n.characters) o.text = n.characters;
  if (n.style) {
    const s = n.style;
    o.font = `${s.fontFamily} ${s.fontWeight} ${s.fontSize}px lh ${Math.round(s.lineHeightPx ?? 0)} ls ${s.letterSpacing ?? 0}`;
  }
  if (n.cornerRadius) o.radius = n.cornerRadius;
  const fills = (n.fills ?? []).filter((f) => f.visible !== false);
  if (fills.length) {
    o.fills = fills.map((f) =>
      f.type === 'SOLID' ? color(f.color, (f.opacity ?? 1) * (f.color.a ?? 1)) : f.type === 'IMAGE' ? `image:${f.imageRef}` : f.type.toLowerCase(),
    );
  }
  if (n.opacity !== undefined && n.opacity < 1) o.opacity = n.opacity;
  const fx = (n.effects ?? []).filter((e) => e.visible !== false);
  if (fx.length) o.effects = fx.map((e) => `${e.type.toLowerCase()} r${e.radius ?? ''}`);
  if (n.visible === false) o.hidden = true;
  if (n.children?.length) o.children = n.children.map((c) => compact(c, origin));
  return o;
};

const main = async () => {
  if (!cmd || cmd === 'help') {
    console.log((await fs.readFile(new URL(import.meta.url), 'utf8')).split('\n').slice(1, 12).join('\n'));
    return;
  }
  const out = flag('out');
  const {key, node} = parse(args.shift() ?? '');
  if (cmd === 'meta') {
    const id = args.shift() ?? node;
    const depth = flag('depth', '4');
    const data = id
      ? await get(`${API}/files/${key}/nodes?ids=${encodeURIComponent(id)}&depth=${depth}`)
      : await get(`${API}/files/${key}?depth=2`);
    const root = id ? data.nodes[id]?.document : data.document;
    if (!root) throw new Error(`Узел ${id} не найден`);
    const origin = root.absoluteBoundingBox ?? {x: 0, y: 0};
    const result = compact(root, origin);
    const text = JSON.stringify(result, null, 1);
    if (out) await fs.writeFile(out, text);
    console.log(out ? `сохранено: ${out}` : text);
    return;
  }
  if (cmd === 'render') {
    const ids = args.length ? args : node ? [node] : [];
    if (!ids.length || !out) throw new Error('render: нужны nodeId и --out');
    const scale = flag('scale', '2');
    const format = flag('format', 'png');
    const data = await get(`${API}/images/${key}?ids=${encodeURIComponent(ids.join(','))}&scale=${scale}&format=${format}`);
    await fs.mkdir(out, {recursive: true});
    for (const [id, url] of Object.entries(data.images)) {
      if (!url) {
        console.log(`${id}: пусто`);
        continue;
      }
      const file = path.join(out, `${id.replace(/[:;]/g, '-')}.${format}`);
      await fs.writeFile(file, Buffer.from(await (await fetch(url)).arrayBuffer()));
      console.log(`${id} → ${file}`);
    }
    return;
  }
  if (cmd === 'fills') {
    if (!out) throw new Error('fills: нужен --out');
    const data = await get(`${API}/files/${key}/images`);
    const refs = args.length ? args : Object.keys(data.meta.images);
    await fs.mkdir(out, {recursive: true});
    for (const ref of refs) {
      const url = data.meta.images[ref];
      if (!url) {
        console.log(`${ref}: не найден`);
        continue;
      }
      const res = await fetch(url);
      const type = res.headers.get('content-type') ?? '';
      const ext = type.includes('jpeg') ? 'jpg' : type.includes('gif') ? 'gif' : 'png';
      const file = path.join(out, `${ref}.${ext}`);
      await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
      console.log(`${ref} → ${file}`);
    }
    return;
  }
  throw new Error(`Неизвестная команда ${cmd}. node tools/figma.mjs help`);
};

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
