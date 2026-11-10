import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {detectProvider,resolveProvider,initializeProvider,readJson} from './provider-context.mjs';

test('detect originating assistant, not installed credentials or incidental environment',()=>{
  assert.equal(detectProvider({CODEX_THREAD_ID:'test'}),'codex');
  assert.equal(detectProvider({CODEX_INTERNAL_ORIGINATOR_OVERRIDE:'ChatGPT'}),'codex');
  assert.equal(detectProvider({CLAUDECODE:'1'}),'claude');
  assert.equal(detectProvider({CLAUDE_CODE_HOST_SESSION_ID:'test'}),'claude');
  assert.equal(detectProvider({OPENAI_API_KEY:'placeholder',ANTHROPIC_API_KEY:'placeholder'}),null);
  assert.equal(detectProvider({CODEX_THREAD_ID:'x',CLAUDECODE:'1'}),null);
  assert.equal(detectProvider({PATH:'/bin/codex'}),null);
});
test('explicit provider overrides; updates preserve saved selection; unknown source stays unresolved',()=>{
  assert.equal(resolveProvider({explicit:'chatgpt',saved:'claude',env:{}}),'codex');
  assert.equal(resolveProvider({saved:'claude',env:{CODEX_THREAD_ID:'x'}}),'claude');
  assert.equal(resolveProvider({saved:'codex',env:{CLAUDECODE:'1'}}),'codex');
  assert.equal(resolveProvider({env:{MOOOTION_INSTALL_SOURCE:'claude',CODEX_THREAD_ID:'x'}}),'claude');
  assert.equal(resolveProvider({env:{}}),null);
  assert.throws(()=>resolveProvider({explicit:'wrong',env:{}}));
});
test('fresh ChatGPT and Claude installations persist defaults without losing local settings',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'moootion-setup-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  for(const [name,env,expected] of [['chatgpt',{CODEX_THREAD_ID:'x'},'codex'],['claude',{CLAUDECODE:'1'},'claude']]){
    const dir=path.join(root,name),file=path.join(dir,'.moootion/settings.json');
    await fs.mkdir(path.dirname(file),{recursive:true});
    await fs.writeFile(file,JSON.stringify({fastPath:false,figmaToken:'fixture-value'}));
    assert.equal(await initializeProvider(dir,{env}),expected);
    assert.deepEqual(await readJson(file),{fastPath:false,figmaToken:'fixture-value',agentProvider:expected});
    const before=await fs.readFile(file,'utf8');
    await initializeProvider(dir,{env:expected==='codex'?{CLAUDECODE:'1'}:{CODEX_THREAD_ID:'x'}});
    assert.equal(await fs.readFile(file,'utf8'),before);
    await initializeProvider(dir,{explicit:expected==='codex'?'claude':'chatgpt',env:{}});
    assert.equal((await readJson(file)).fastPath,false);
  }
});
test('unknown context creates no invented default, corrupt settings are not overwritten',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'moootion-setup-unknown-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const file=path.join(root,'.moootion/settings.json');
  assert.equal(await initializeProvider(root,{env:{}}),null);
  await assert.rejects(fs.access(file));
  await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'broken');
  await assert.rejects(initializeProvider(root,{env:{CODEX_THREAD_ID:'x'}}));
  assert.equal(await fs.readFile(file,'utf8'),'broken');
});

test('concurrent first-launch probes persist the same default without temporary-file collisions',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'moootion-setup-concurrent-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const results=await Promise.all(Array.from({length:8},()=>initializeProvider(root,{env:{CODEX_THREAD_ID:'x'}})));
  assert.ok(results.every(p=>p==='codex'));
  assert.equal((await readJson(path.join(root,'.moootion/settings.json'))).agentProvider,'codex');
});
