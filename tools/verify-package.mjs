// Validate the actual release archive on its target runner, using its bundled Node.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
const platforms = {'mac-arm64': ['darwin', 'arm64'], 'mac-x64': ['darwin', 'x64'], 'win-x64': ['win32', 'x64']};
assert.ok(platforms[target], 'Unknown package target');
assert.deepEqual([process.platform, process.arch], platforms[target], 'Runner must match the package target');
const win = target === 'win-x64';
const filename = `moootion-${target}.${win ? 'zip' : 'tar.gz'}`;
const archive = path.join(root, 'dist', filename);
const entries = execFileSync('tar', ['-tf', archive], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024}).trim().split(/\r?\n/);
for (const entry of entries) {
  const parts = entry.replaceAll('\\', '/').split('/');
  assert.equal(parts[0], 'Moootion', `Unexpected archive root: ${entry}`);
  assert.ok(!parts.includes('..'), 'Archive traversal');
  assert.ok(!['projects', 'temp', 'renders', 'trash', '.git', '.moootion'].includes(parts[1]), `Private data in archive: ${entry}`);
}
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'moootion-package-check-'));
try {
  execFileSync('tar', ['-xf', archive, '-C', temporary], {stdio: 'inherit'});
  const app = path.join(temporary, 'Moootion');
  const node = path.join(app, '.runtime', 'node', win ? 'node.exe' : 'bin/node');
  const npm = path.join(app, '.runtime', 'node', win ? 'node_modules/npm/bin/npm-cli.js' : 'lib/node_modules/npm/bin/npm-cli.js');
  for (const required of ['server/index.ts', 'studio/index.html', 'runtime/manifest.ts', 'install/executor/Dockerfile', 'docs/astra-method-13.md', '.sdk-version', win ? 'moootion.cmd' : 'moootion']) {
    await fs.access(path.join(app, required));
  }
  const method = await fs.readFile(path.join(app, 'rules/astra-method-13.md'));
  assert.equal(createHash('sha256').update(method).digest('hex'), '07a2ed41bbf1624f7ac552847e24d72f57c5ac58753d4754a987726ce49dfc5b');
  const runtime = JSON.parse(execFileSync(node, ['-p', 'JSON.stringify([process.platform,process.arch])'], {cwd: app, encoding: 'utf8'}));
  assert.deepEqual(runtime, platforms[target]);
  execFileSync(node, [npm, '--version'], {cwd: app, stdio: 'inherit'});
  assert.ok(!(await fs.readdir(path.join(app, 'node_modules/@anthropic-ai'))).some(name => name.startsWith('claude-agent-sdk')), 'SDK must be installed separately');
  // Dependencies and the downloaded browser must work from the extracted archive.
  execFileSync(node, ['node_modules/tsx/dist/cli.mjs', 'tools/smoke.ts'], {cwd: app, stdio: 'inherit', timeout: 240_000});
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  await fs.writeFile(`${archive}.sha256`, `${hash.digest('hex')}  ${filename}\n`);
  console.log(`PACKAGE OK: ${filename}; bundled Node/npm, exact method 13, extracted render and checksum`);
} finally {
  // Only the unique directory created by mkdtemp above is removed.
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temporary).startsWith('moootion-package-check-'));
  await fs.rm(temporary, {recursive: true, force: true});
}
