#!/usr/bin/env node
// Builds a release archive for one platform (run in CI after `npm ci` and the smoke test):
//   node tools/package.mjs mac-arm64 | mac-x64 | win-x64
// The archive holds the studio code, installed packages, Remotion's headless browser and its own Node + npm —
// a subscriber needs nothing else. Left out: caches, and Anthropic's Claude Agent SDK (its licence keeps
// redistribution with Anthropic — the installer fetches it from npm, as any `npm install` would).
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
if (!['mac-arm64', 'mac-x64', 'win-x64'].includes(target)) throw new Error(`unknown target: ${target}`);
const win = target.startsWith('win');
const REPO = process.env.GITHUB_REPOSITORY ?? 'OWNER/REPO';

const DIST = path.join(ROOT, 'dist');
const STAGE = path.join(DIST, 'stage', 'Moootion');
await fs.rm(path.join(DIST, 'stage'), {recursive: true, force: true});
await fs.mkdir(STAGE, {recursive: true});

// the app: the same whitelist the public repository has
const APP = ['server', 'studio', 'runtime', 'library', 'templates', 'tools', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'README.md', 'NOTICE.md', 'rules', 'docs/astra-method-13.md', 'docs/github-export.md'];
for (const item of APP) {
  const from = path.join(ROOT, item);
  if (await fs.stat(from).catch(() => null)) await fs.cp(from, path.join(STAGE, item), {recursive: true});
}

// installed packages, without caches and without Anthropic's SDK
const SKIP = [/^\.cache(\/|$)/, /^\.vite(\/|$)/, /^@anthropic-ai\/claude-agent-sdk/];
await fs.cp(path.join(ROOT, 'node_modules'), path.join(STAGE, 'node_modules'), {
  recursive: true,
  verbatimSymlinks: true,
  filter: (src) => {
    const rel = path.relative(path.join(ROOT, 'node_modules'), src).split(path.sep).join('/');
    return !SKIP.some((re) => re.test(rel));
  },
});
const lock = JSON.parse(await fs.readFile(path.join(ROOT, 'package-lock.json'), 'utf8'));
const sdkVersion = lock.packages['node_modules/@anthropic-ai/claude-agent-sdk']?.version;
if (!sdkVersion) throw new Error('claude-agent-sdk version not found in package-lock.json');
await fs.writeFile(path.join(STAGE, '.sdk-version'), `${sdkVersion}\n`);

// its own Node and npm, from the Node that runs this script
const nodeHome = win ? path.dirname(process.execPath) : path.resolve(path.dirname(process.execPath), '..');
const RT = path.join(STAGE, '.runtime', 'node');
if (win) {
  await fs.mkdir(RT, {recursive: true});
  await fs.copyFile(process.execPath, path.join(RT, 'node.exe'));
  await fs.cp(path.join(nodeHome, 'node_modules', 'npm'), path.join(RT, 'node_modules', 'npm'), {recursive: true});
} else {
  await fs.mkdir(path.join(RT, 'bin'), {recursive: true});
  await fs.copyFile(process.execPath, path.join(RT, 'bin', 'node'));
  await fs.chmod(path.join(RT, 'bin', 'node'), 0o755);
  await fs.cp(path.join(nodeHome, 'lib', 'node_modules', 'npm'), path.join(RT, 'lib', 'node_modules', 'npm'), {recursive: true});
}

// launchers, with the repository name filled in
const fill = async (from, to, mode) => {
  const text = (await fs.readFile(path.join(ROOT, 'install', from), 'utf8')).replaceAll('__REPO__', REPO);
  await fs.writeFile(path.join(STAGE, to), win ? text.replace(/\r?\n/g, '\r\n') : text);
  if (mode) await fs.chmod(path.join(STAGE, to), mode);
};
if (win) {
  await fill('moootion.cmd', 'moootion.cmd');
} else {
  await fill('moootion.sh', 'moootion', 0o755);
}

// the archive: tar.gz keeps the executable bits on the Mac; Windows' tar writes zip with -a
const name = win ? `moootion-${target}.zip` : `moootion-${target}.tar.gz`;
const out = path.join(DIST, name);
await fs.rm(out, {force: true});
execFileSync('tar', win ? ['-a', '-cf', out, '-C', path.join(DIST, 'stage'), 'Moootion'] : ['-czf', out, '-C', path.join(DIST, 'stage'), 'Moootion'], {stdio: 'inherit'});

// the installers go to the release next to the archives
for (const f of ['install.sh', 'install.ps1']) {
  const text = (await fs.readFile(path.join(ROOT, 'install', f), 'utf8')).replaceAll('__REPO__', REPO);
  await fs.writeFile(path.join(DIST, f), text);
}
const size = (await fs.stat(out)).size;
console.log(`${name}: ${(size / 1024 / 1024).toFixed(0)} МБ (Claude Agent SDK ${sdkVersion} поставит установщик)`);
