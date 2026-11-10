#!/usr/bin/env node
// Source export only. No git commands, network calls, deletion or in-place mirroring.
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const POLICY = Object.freeze({
  directories: ['server', 'studio', 'runtime', 'library', 'templates', 'tools', 'install'],
  files: ['package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'README.md', 'NOTICE.md', '.gitignore', '.gitattributes', '.github/workflows/release.yml', '.github/workflows/check.yml', 'rules/astra-method-13.md', 'docs/astra-method-13.md', 'docs/github-export.md'],
  optionalFiles: ['LICENSE', 'LICENSE.md', 'AGENTS.md'],
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
});
const EXCLUDED = new Set(['.git', '.moootion', '.runtime', '.codex', '.claude', '.ssh', '.aws', 'projects', 'personalprojects', 'temp', 'trash', 'node_modules', '__pycache__', 'docker-data', 'renders', 'out', 'dist', 'coverage', 'internaldocs', 'internal-docs']);
const TEXT = /\.(?:ts|tsx|mts|cts|mjs|cjs|js|jsx|json|md|css|html|sh|ps1|cmd|bat|yml|yaml|py|txt|svg|glsl|vert|frag|toml)$/i;
const BINARY = /\.(?:png|jpg|jpeg|webp|gif|ico|woff2?|ttf|otf|mp3|mp4)$/i;
const SECRET_FILE = /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.pypirc|credentials(?:\.[^/]*)?|secrets?(?:\.[^/]*)?|id_(?:rsa|ed25519)|.*\.(?:pem|key|p12|pfx|kdbx)|chat\.json|settings\.json|history\.git)(?:\/|$)/i;
const SECRET_PATTERNS = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['service-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16})\b/],
  ['credential-assignment', /(?:["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|authorization)["']?\s*[:=]\s*["'])(?!process\.|\$\{|example|placeholder|fixture|test|dummy|fake|YOUR_|<)[A-Za-z0-9+/_=-]{24,}["']/i],
  ['personal-home-path', /(?:[A-Z]:[\\/]+Users[\\/]+(?!Public\b|Default\b|USER\b|USERNAME\b|example\b|fixture\b)[\w.-]+|\/(?:Users|home)\/(?!user\b|runner\b|example\b|fixture\b)[\w.-]+)/i],
];
const digest = data => createHash('sha256').update(data).digest('hex');
const posix = p => p.split(path.sep).join('/');
const contains = (parent, child) => {const rel = path.relative(parent, child); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));};
async function statOrNull(p) {try {return await fs.lstat(p);} catch (e) {if (e.code === 'ENOENT') return null; throw e;}}

// Inspect each existing ancestor, including Windows directory junctions. Never follow links.
export async function assertNoLinks(p) {
  const absolute = path.resolve(p), parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const st = await statOrNull(current);
    if (!st) continue;
    if (st.isSymbolicLink()) throw new Error('Symbolic link/junction rejected: ' + current);
    if (current !== absolute && !st.isDirectory()) throw new Error('Non-directory ancestor: ' + current);
  }
}
export async function assertDestination(root, target) {
  root = path.resolve(root); target = path.resolve(target);
  if (contains(root, target) || contains(target, root)) throw new Error('Source and destination must be disjoint; ancestors/descendants rejected');
  await assertNoLinks(root); await assertNoLinks(target);
  for (const p of [target, target + '.zip', target + '.inventory.json', target + '.sha256']) {
    await assertNoLinks(p);
    if (await statOrNull(p)) throw new Error('Destination already exists; nothing may be replaced: ' + p);
  }
}
async function readRegular(root, rel) {
  const p = path.join(root, rel);
  await assertNoLinks(p);
  const before = await fs.lstat(p);
  if (!before.isFile() || before.nlink > 1) throw new Error('Not an independent regular file: ' + rel);
  if (before.size > POLICY.maxFileBytes) throw new Error('Large file exceeds 10 MiB: ' + rel);
  const handle = await fs.open(p, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.nlink > 1 || st.ino !== before.ino || st.dev !== before.dev) throw new Error('Source changed during audit: ' + rel);
    const data = await handle.readFile();
    const after = await handle.stat();
    await assertNoLinks(p);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || data.length !== before.size) throw new Error('Source changed during read: ' + rel);
    return {data, mode: before.mode & 0o777};
  } finally {await handle.close();}
}

export async function auditSource(root = ROOT) {
  root = path.resolve(root); await assertNoLinks(root);
  const entries = [], excluded = [], errors = [], notices = [];
  let totalBytes = 0;
  const visit = async (rel, optional = false) => {
    const p = path.join(root, rel), st = await statOrNull(p);
    if (!st) {if (!optional) errors.push({path: rel, rule: 'missing-required-source'}); return;}
    if (st.isSymbolicLink()) {errors.push({path: rel, rule: 'symlink-or-junction'}); return;}
    const parts = rel.split('/');
    if (parts.some(x => EXCLUDED.has(x.toLowerCase())) || /(?:\.tmp|\.log|\.bak)$/i.test(rel)) {excluded.push(rel); return;}
    if (SECRET_FILE.test(rel)) {errors.push({path: rel, rule: 'private-or-credential-file'}); return;}
    if (st.isDirectory()) {
      for (const name of (await fs.readdir(p)).sort()) await visit(rel + '/' + name);
      return;
    }
    if (!st.isFile()) {errors.push({path: rel, rule: 'special-file'}); return;}
    if (st.nlink > 1) {errors.push({path: rel, rule: 'hardlink'}); return;}
    if (st.size > POLICY.maxFileBytes) {errors.push({path: rel, rule: 'large-file', bytes: st.size}); return;}
    totalBytes += st.size;
    if (totalBytes > POLICY.maxTotalBytes) {errors.push({path: rel, rule: 'total-size-limit'}); return;}
    const isText = TEXT.test(rel) || ['.gitignore', '.gitattributes', 'LICENSE', 'Dockerfile'].includes(path.basename(rel));
    if (!isText && !(BINARY.test(rel) && /^(?:library|templates|studio)\//.test(rel))) {errors.push({path: rel, rule: 'unreviewed-file-type'}); return;}
    try {
      let {data, mode} = await readRegular(root, rel);
      const sourceSha256 = digest(data);
      let transformation;
      if (isText) {
        let text;
        try {text = new TextDecoder('utf-8', {fatal: true}).decode(data);} catch {errors.push({path: rel, rule: 'invalid-utf8'}); return;}
        if (text.includes('\0')) {errors.push({path: rel, rule: 'binary-in-text-file'}); return;}
        text.split('\n').forEach((line, i) => {
          for (const [rule, re] of SECRET_PATTERNS) if (re.test(line)) errors.push({path: rel, line: i + 1, rule});
        });
        // Client names in unit tests are fixtures, not credentials. Do not exempt tokens or paths.
        if (/\bS7\b|додо|\bdodo\b|StartApps|VyborDopov|TT Hoves|SF Pro/i.test(text)) notices.push({path: rel, rule: /\.test\.[cm]?[jt]s$/.test(rel) ? 'fixture-name-review' : 'brand-or-material-review'});
      } else notices.push({path: rel, rule: 'binary-asset-manual-review'});
      // Generate the public source ignore without modifying the legacy working ignore.
      if (rel === '.gitignore') {
        data = Buffer.from('# Generated source export: runtime data is private.\nnode_modules/\nprojects/\ntemp/\ntrash/\nrenders/\nout/\ndist/\ndocker-data/\n.moootion/\n.runtime/\n.codex/\n.claude/\n.env\n.env.*\n.npmrc\n*.pem\n*.key\n*.p12\n*.pfx\n**/*.tmp\n**/*.log\n__pycache__/\ncoverage/\n.DS_Store\nThumbs.db\n');
        transformation = 'Generated source-export ignore; working legacy ignore remains unchanged';
      }
      entries.push({path: rel, bytes: data.length, sha256: digest(data), sourceSha256, transformation, mode, data});
    } catch (e) {errors.push({path: rel, rule: 'unsafe-read', message: e.message});}
  };
  for (const rel of [...POLICY.directories, ...POLICY.files]) await visit(rel);
  for (const rel of POLICY.optionalFiles) await visit(rel, true);
  entries.sort((a,b) => a.path.localeCompare(b.path, 'en'));
  const seen = new Set();
  for (const e of entries) {const key = e.path.toLowerCase(); if (seen.has(key)) errors.push({path:e.path,rule:'case-collision'}); seen.add(key);}
  const selectedTop = new Set([...POLICY.directories, ...POLICY.files, ...POLICY.optionalFiles].map(x => x.split('/')[0]));
  for (const name of await fs.readdir(root)) if (!selectedTop.has(name)) excluded.push(name + ' (outside root allowlist)');
  return {root, entries, errors, excluded, notices, totalBytes: entries.reduce((n,e) => n + e.bytes, 0), ok: errors.length === 0};
}
export function auditReport(a) {
  return {schema: 1, ok: a.ok, policy: POLICY, totalBytes: a.totalBytes, errors: a.errors, excluded: a.excluded, notices: a.notices, files: a.entries.map(({data, ...e}) => e), limitations: 'Allowlist and heuristic secret scan; binary assets and rights require human review. No claim of exhaustive secret detection.'};
}

// Deterministic, uncompressed ZIP (small bounded source tree, no ZIP64). No external archiver needed.
const CRC_TABLE = Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc32 = data => {let c=0xffffffff;for(const b of data)c=CRC_TABLE[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
export function sourceZip(entries) {
  if (entries.length > 65535) throw new Error('ZIP entry limit');
  const chunks=[], central=[]; let offset=0;
  for(const e of entries){
    const name=Buffer.from(e.path,'utf8'), crc=crc32(e.data), h=Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(33,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(e.data.length,18);h.writeUInt32LE(e.data.length,22);h.writeUInt16LE(name.length,26);
    chunks.push(h,name,e.data);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(0x0314,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(33,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(e.data.length,20);c.writeUInt32LE(e.data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(((0o100000|e.mode)<<16)>>>0,38);c.writeUInt32LE(offset,42);central.push(c,name);offset+=h.length+name.length+e.data.length;
  }
  const directory=Buffer.concat(central), end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...chunks,directory,end]);
}
async function ensureParents(p) {
  await assertNoLinks(p);
  const parent=path.dirname(p); if(parent!==p && !(await statOrNull(parent))) await ensureParents(parent);
  const st=await statOrNull(p);
  if(st){if(!st.isDirectory())throw new Error('Parent is not directory: '+p);return;}
  await fs.mkdir(p); await assertNoLinks(p);
}
async function writeExclusive(p, data, mode = 0o644) {
  await assertNoLinks(p);
  const h=await fs.open(p,'wx',mode);
  try {await h.writeFile(data);} finally {await h.close();}
}
export async function exportSource(root, target) {
  root=path.resolve(root);target=path.resolve(target);
  await assertDestination(root,target);
  const a=await auditSource(root);
  if(!a.ok) throw new Error('Source audit failed (no export written):\n'+JSON.stringify(auditReport(a).errors,null,2));
  const zip=sourceZip(a.entries), report={...auditReport(a),createdAt:new Date().toISOString(),archive:{file:path.basename(target)+'.zip',bytes:zip.length,sha256:digest(zip)}};
  await assertDestination(root,target); // recheck immediately before any output
  await ensureParents(path.dirname(target));
  await fs.mkdir(target); // exclusive: even an existing empty folder is refused
  // Failure leaves only newly created partial outputs for inspection. Never delete or retry over them.
  for(const e of a.entries){
    const p=path.join(target,e.path);await ensureParents(path.dirname(p));await writeExclusive(p,e.data,e.mode);
    if(digest(await fs.readFile(p))!==e.sha256)throw new Error('Copy verification failed: '+e.path);
  }
  await writeExclusive(target+'.zip',zip);
  const inventory=Buffer.from(JSON.stringify(report,null,2)+'\n');await writeExclusive(target+'.inventory.json',inventory);
  const checksums=[`${digest(zip)}  ${path.basename(target)}.zip`,`${digest(inventory)}  ${path.basename(target)}.inventory.json`,...a.entries.map(e=>`${e.sha256}  ${path.basename(target)}/${e.path}`)].join('\n')+'\n';
  await writeExclusive(target+'.sha256',checksums);
  return {target,files:a.entries.length,bytes:a.totalBytes,zip:target+'.zip',inventory:target+'.inventory.json',checksums:target+'.sha256'};
}
async function main() {
  const args=process.argv.slice(2), audit=args.includes('--audit');
  if(args.some(x=>x.startsWith('--')&&x!=='--audit'))throw new Error('Unknown option. Usage: node tools/publish.mjs [--audit] <new-folder>');
  const positional=args.filter(x=>x!=='--audit');if(positional.length!==1)throw new Error('Usage: node tools/publish.mjs [--audit] <new-folder>');
  const target=path.resolve(positional[0]);await assertDestination(ROOT,target);
  if(audit){const a=await auditSource(ROOT);console.log(JSON.stringify(auditReport(a),null,2));if(!a.ok)process.exitCode=1;}
  else console.log(JSON.stringify(await exportSource(ROOT,target),null,2));
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
