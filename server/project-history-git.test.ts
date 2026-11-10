import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createProjectGit} from './project-history-git';
const exec = promisify(execFile);
const command = async (root: string, ...args: string[]) => (await exec('git', ['-C', root, ...args], {windowsHide: true})).stdout.trim();
const initSource = async (root: string) => {
  await command(root, 'init', '-q');
  await command(root, 'config', 'user.name', 'Fixture');
  await command(root, 'config', 'user.email', 'fixture@example.invalid');
};

test('fresh clone: snapshots and restoration never enter source Git; chats are excluded', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moootion-history-'));
  try {
    await initSource(root);
    await fs.writeFile(path.join(root, '.gitignore'), 'projects/\n.moootion/\n');
    await fs.writeFile(path.join(root, 'README.md'), 'source');
    await command(root, 'add', '.'); await command(root, 'commit', '-qm', 'source');
    const sourceHead = await command(root, 'rev-parse', 'HEAD');
    const dir = path.join(root, 'projects', 'video');
    await fs.mkdir(path.join(dir, '.moootion'), {recursive: true});
    await fs.writeFile(path.join(dir, 'project.json'), '{"version":1}');
    await fs.writeFile(path.join(dir, '.moootion', 'chat.json'), 'private chat');
    const history = createProjectGit(root); await history.ensure();
    assert.equal(history.relative('video'), 'video');
    await history.run(['add', '-A', '--', history.relative('video')]);
    await history.run(['commit', '-qm', 'snapshot']);
    const first = await history.run(['rev-parse', 'HEAD']);
    assert.equal(await history.run(['ls-files']), 'video/project.json');
    await fs.writeFile(path.join(dir, 'project.json'), '{"version":2}');
    await history.run(['add', '-A', '--', 'video']); await history.run(['commit', '-qm', 'second']);
    await history.run(['checkout', first, '--', 'video']);
    assert.equal(await fs.readFile(path.join(dir, 'project.json'), 'utf8'), '{"version":1}');
    assert.equal(await command(root, 'rev-parse', 'HEAD'), sourceHead);
    assert.equal(await command(root, 'status', '--porcelain'), '');
    assert.equal(await command(root, 'log', '--format=%H', '--', 'projects'), '');
    const restarted = createProjectGit(root); await restarted.ensure();
    assert.equal(restarted.relative('video'), 'video');
    assert.ok((await restarted.run(['log', '--format=%s'])).includes('snapshot'));
  } finally {await fs.rm(root, {recursive: true, force: true});}
});

test('existing project snapshots retain legacy paths and commits', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moootion-history-legacy-'));
  try {
    await initSource(root);
    await fs.mkdir(path.join(root, 'projects', 'video'), {recursive: true});
    await fs.writeFile(path.join(root, 'projects', 'video', 'project.json'), '{}');
    await command(root, 'add', '.'); await command(root, 'commit', '-qm', 'old snapshot');
    const head = await command(root, 'rev-parse', 'HEAD');
    const history = createProjectGit(root); await history.ensure();
    assert.equal(history.relative('video'), 'projects/video');
    assert.equal(await history.run(['rev-parse', 'HEAD']), head);
    assert.equal(await history.run(['show', head + ':projects/video/project.json']), '{}');
    assert.equal(await fs.stat(path.join(root, '.moootion', 'history.git')).catch(() => null), null);
  } finally {await fs.rm(root, {recursive: true, force: true});}
});

test('standalone install gets private history without creating source Git', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moootion-history-new-'));
  try {
    const history = createProjectGit(root); await history.ensure();
    assert.equal(history.relative('video'), 'video');
    assert.equal(await fs.stat(path.join(root, '.git')).catch(() => null), null);
    assert.ok(await fs.stat(path.join(root, '.moootion', 'history.git')));
    assert.throws(() => history.relative('../other'));
  } finally {await fs.rm(root, {recursive: true, force: true});}
});
