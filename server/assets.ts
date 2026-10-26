// The project's asset bin: files in inputs/assets/, their roles and origin in
// inputs/assets.json. The user fills it from the «Ассеты» tab, the agent adds
// what it generates (Magnific); every agent run gets the table.
import fs from 'node:fs/promises';
import path from 'node:path';
import {ASSET_ROLES} from '../runtime/styles';
import {projectDir} from './paths';

export type AssetEntry = {
  file: string;
  role: string;
  tags: string[];
  /** where it came from: 'import' (the user), 'magnific', 'agent'… */
  source: string;
  prompt?: string;
  model?: string;
  /** credits spent, as the agent reported them */
  cost?: number;
  addedAt?: string;
};
export type Asset = AssetEntry & {url: string; path: string; type: string; size: number; missing?: boolean};


const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
};
const typeOf = (file: string) => TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

/** a first guess at the role from the file type and name */
export const guessRole = (file: string) => {
  const t = typeOf(file);
  if (/logo/i.test(file)) return 'logo';
  if (/icon/i.test(file)) return 'icon';
  if (/^(bg|background)/i.test(file)) return 'background';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return /sfx|whoosh|click/i.test(file) ? 'sfx' : 'music';
  if (t.startsWith('font/')) return 'font';
  if (/screen|mockup|phone/i.test(file)) return 'screen';
  return t.startsWith('image/') ? 'photo' : 'other';
};

const dirOf = (id: string) => path.join(projectDir(id), 'inputs', 'assets');
const jsonOf = (id: string) => path.join(projectDir(id), 'inputs', 'assets.json');

const readEntries = async (id: string): Promise<AssetEntry[]> => {
  try {
    const v = JSON.parse(await fs.readFile(jsonOf(id), 'utf8'));
    return Array.isArray(v) ? (v as AssetEntry[]).filter((e) => e && typeof e.file === 'string') : [];
  } catch {
    return [];
  }
};
const writeEntries = async (id: string, list: AssetEntry[]) => {
  await fs.mkdir(path.dirname(jsonOf(id)), {recursive: true});
  await fs.writeFile(jsonOf(id), JSON.stringify(list, null, 2) + '\n', 'utf8');
};

/** a file name inside inputs/assets/ (no folders, no escapes) */
const safeFile = (name: string) => {
  const base = path.basename(name.replace(/\\/g, '/'));
  return base.replace(/[^\w.\-а-яё ]+/gi, '_').slice(-100) || 'file';
};

/**
 * The bin as the studio shows it: listed entries (flagged when the file is gone) plus
 * files somebody dropped into the folder without a record.
 */
export const listAssets = async (id: string): Promise<Asset[]> => {
  const entries = await readEntries(id);
  const files = new Map<string, number>();
  for (const e of await fs.readdir(dirOf(id), {withFileTypes: true}).catch(() => [])) {
    if (!e.isFile()) continue;
    const st = await fs.stat(path.join(dirOf(id), e.name)).catch(() => null);
    if (st) files.set(e.name, st.size);
  }
  const seen = new Set<string>();
  const out: Asset[] = [];
  const make = (e: AssetEntry): Asset => ({
    ...e,
    tags: Array.isArray(e.tags) ? e.tags : [],
    path: `inputs/assets/${e.file}`,
    url: `/files/${id}/inputs/assets/${encodeURIComponent(e.file)}`,
    type: typeOf(e.file),
    size: files.get(e.file) ?? 0,
    ...(files.has(e.file) ? {} : {missing: true}),
  });
  for (const e of entries) {
    if (seen.has(e.file)) continue;
    seen.add(e.file);
    out.push(make(e));
  }
  for (const f of files.keys()) {
    if (!seen.has(f)) out.push(make({file: f, role: guessRole(f), tags: [], source: 'folder'}));
  }
  return out;
};

const uniqueName = async (id: string, name: string) => {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 0; ; i++) {
    const n = i ? `${stem}-${i + 1}${ext}` : name;
    const exists = await fs
      .access(path.join(dirOf(id), n))
      .then(() => true)
      .catch(() => false);
    if (!exists) return n;
  }
};

export const addAssets = async (id: string, files: {name: string; data: Buffer}[], role?: string) => {
  await fs.mkdir(dirOf(id), {recursive: true});
  const list = await readEntries(id);
  for (const f of files) {
    const name = await uniqueName(id, safeFile(f.name));
    await fs.writeFile(path.join(dirOf(id), name), f.data);
    list.push({
      file: name,
      role: role && ASSET_ROLES[role] ? role : guessRole(name),
      tags: [],
      source: 'import',
      addedAt: new Date().toISOString(),
    });
  }
  await writeEntries(id, list);
  return listAssets(id);
};

export const updateAsset = async (id: string, file: string, patch: {role?: string; tags?: string[]}) => {
  const list = await readEntries(id);
  let e = list.find((x) => x.file === file);
  if (!e) {
    // a file without a record (dropped into the folder): the first edit creates it
    e = {file: safeFile(file), role: guessRole(file), tags: [], source: 'folder'};
    list.push(e);
  }
  if (patch.role && ASSET_ROLES[patch.role]) e.role = patch.role;
  if (patch.tags) e.tags = patch.tags.map((t) => t.trim()).filter(Boolean).slice(0, 20);
  await writeEntries(id, list);
  return listAssets(id);
};

export const removeAsset = async (id: string, file: string) => {
  const name = safeFile(file);
  await fs.rm(path.join(dirOf(id), name), {force: true});
  await writeEntries(
    id,
    (await readEntries(id)).filter((x) => x.file !== file),
  );
  return listAssets(id);
};

/** the table every agent run gets: what is in the bin and what each file is for */
export const assetsSection = async (id: string) => {
  const list = (await listAssets(id).catch(() => [] as Asset[])).filter((a) => !a.missing);
  if (!list.length) return '';
  const lines = list.map((a) => {
    const parts = [`${a.path}`, `роль: ${ASSET_ROLES[a.role] ?? a.role}`];
    if (a.tags.length) parts.push(`теги: ${a.tags.join(', ')}`);
    if (a.source && a.source !== 'import' && a.source !== 'folder') parts.push(`источник: ${a.source}${a.model ? ` (${a.model})` : ''}`);
    if (a.prompt) parts.push(`промпт: «${a.prompt.slice(0, 120)}»`);
    return `- ${parts.join(' · ')}`;
  });
  return `
## Корзина ассетов проекта (inputs/assets.json)
Материалы, которые пользователь собрал для ролика. Роль говорит, для чего файл; бери его оттуда, а не ищи замену.
В коде используй копию в public/ (скопируй файл туда, путь — через asset()). Новые ассеты (Magnific, нарезки)
добавляй в inputs/assets/ и записывай в inputs/assets.json.
${lines.join('\n')}
`;
};
