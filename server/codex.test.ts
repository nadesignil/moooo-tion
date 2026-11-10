import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {CodexClient} from './codex';
import {scopedPath} from './codex-run';

test('Codex project files: reject traversal, absolute escapes and junction escapes', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'moootion-codex-paths-'));
  const project = path.join(base, 'project');
  const neighbor = path.join(base, 'neighbor');
  await fs.mkdir(project); await fs.mkdir(neighbor);
  await fs.writeFile(path.join(neighbor, 'secret.txt'), 'must not be read');
  try {
    assert.equal(await scopedPath(project, 'new/scene.tsx', true), path.join(project, 'new', 'scene.tsx'));
    await assert.rejects(scopedPath(project, '../neighbor/secret.txt'));
    await assert.rejects(scopedPath(project, path.join(neighbor, 'secret.txt')));
    await fs.symlink(neighbor, path.join(project, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(scopedPath(project, 'linked/secret.txt'));
    await assert.rejects(scopedPath(project, 'linked/new.txt', true));
  } finally {await fs.rm(base, {recursive: true, force: true});}
});

test('Codex stdio: initialization, requests, tool callbacks, errors, timeout and disconnect', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'moootion-codex-rpc-'));
  const fixture = path.join(base, 'fake-codex.mjs');
  await fs.writeFile(fixture, `
    import {createInterface} from 'node:readline';
    const send = v => process.stdout.write(JSON.stringify(v)+'\\n');
    console.log('non-JSON startup banner');
    createInterface({input:process.stdin}).on('line', line => {
      const m=JSON.parse(line);
      if(m.method==='initialize') send({id:m.id,result:{}});
      if(m.method==='echo') send({id:m.id,result:m.params});
      if(m.method==='bad') send({id:m.id,error:{message:'expected failure'}});
      if(m.method==='callback') {globalThis.waitingId=m.id;send({id:'tool-1',method:'item/tool/call',params:{tool:'studio_read'}});}
      if(m.id==='tool-1') send({id:globalThis.waitingId,result:m.result});
      if(m.method==='exit') process.exit(0);
    });
  `);
  const client = await new CodexClient(fixture).init();
  try {
    assert.deepEqual(await client.request('echo', {ok:true}), {ok:true});
    client.onRequest = async (method,p) => ({method,tool:p.tool});
    assert.deepEqual(await client.request('callback'), {method:'item/tool/call',tool:'studio_read'});
    await assert.rejects(client.request('bad'), /expected failure/);
    await assert.rejects(client.request('no-reply', {}, 30), /Codex/);
    await assert.rejects(client.request('exit'), /Codex/);
    await assert.rejects(client.request('echo'), /Codex/);
  } finally {client.close(); await fs.rm(base, {recursive:true,force:true});}
});
