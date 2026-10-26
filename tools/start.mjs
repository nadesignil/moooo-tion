#!/usr/bin/env node
// Starts the studio the way a subscriber runs it: the API (no watch — a restart would kill agent runs) and the
// web studio, both on the Node that runs this script (the release ships its own), then opens the browser.
//   node tools/start.mjs [--no-open]
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = 'http://localhost:5173';
const node = process.execPath;
const children = [];

const run = (name, args) => {
  const child = spawn(node, args, {cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, FORCE_COLOR: '1'}});
  const tag = name === 'api' ? '\x1b[90m[api]\x1b[0m' : '\x1b[32m[web]\x1b[0m';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (d) => {
      for (const line of String(d).split('\n')) if (line.trim()) console.log(`${tag} ${line}`);
    });
  }
  child.on('exit', (code) => {
    console.log(`${tag} остановлен (${code ?? 0})`);
    stopAll();
  });
  children.push(child);
};

const stopAll = () => {
  for (const c of children) if (c.exitCode === null) c.kill();
  setTimeout(() => process.exit(0), 300);
};
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

const openBrowser = (url) => {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  spawn(cmd, args, {stdio: 'ignore', detached: true}).unref();
};

run('api', [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/index.ts']);
run('web', [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')]);

if (!process.argv.includes('--no-open')) {
  // open once the studio answers (the first start re-optimizes dependencies, give it time)
  const started = Date.now();
  const wait = async () => {
    try {
      const res = await fetch(WEB);
      if (res.ok) {
        console.log(`\nСтудия: ${WEB}  (остановить — Ctrl+C или закрыть это окно)\n`);
        return openBrowser(WEB);
      }
    } catch {
      // not yet
    }
    if (Date.now() - started < 60_000) setTimeout(wait, 700);
  };
  setTimeout(wait, 1200);
}
