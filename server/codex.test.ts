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

test('studio run keeps the selected model and executes dynamic tools in its own thread', async () => {
  const {runCodex} = await import('./codex-run');
  const {projectDir} = await import('./paths');
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'moootion-codex-tools-'));
  const fixture = path.join(base, 'fake-codex.mjs');
  const id = 'zz-tools-' + Date.now().toString(36);
  const dir = projectDir(id);
  const previous = process.env.MOOOTION_CODEX_BIN;
  await fs.mkdir(path.join(dir, '.moootion'), {recursive:true});
  await fs.writeFile(path.join(dir, '.moootion', 'codex-run.json'), JSON.stringify({model:'gpt-6-astra'}));
  await fs.writeFile(path.join(dir, 'probe.txt'), 'studio tool bridge works');
  await fs.writeFile(fixture, `
    import {createInterface} from 'node:readline';
    import assert from 'node:assert/strict';
    const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');
    createInterface({input:process.stdin}).on('line', line=>{
      const m=JSON.parse(line);
      try {
        if(m.method==='initialize') {assert.equal(m.params.capabilities.experimentalApi,true);send({id:m.id,result:{}});}
        if(m.method==='config/read') send({id:m.id,result:{config:{model:'gpt-6.1-sol',mcp_servers:{external:{}}}}});
        if(m.method==='model/list') send({id:m.id,result:{data:[{model:'gpt-6.1-sol',isDefault:true},{model:'gpt-6-astra',supportedReasoningEfforts:[{reasoningEffort:'max'}]}]}});
        if(m.method==='thread/start') {
          assert.equal(m.params.model,'gpt-6-astra');
          assert.equal(m.params.config.model_reasoning_effort,'max');
          assert.match(m.params.developerInstructions, /# Метод 13/);
          assert.equal(m.params.config['features.multi_agent'],false);
          assert.equal(m.params.config['features.multi_agent_v2'],false);
          assert.equal(m.params.config['features.shell_tool'],false);
          assert.equal(m.params.config['mcp_servers.external.enabled'],false);
          assert.ok(m.params.dynamicTools.some(t=>t.name==='studio_read' && t.deferLoading===false));
          assert.ok(m.params.dynamicTools.some(t=>t.name==='studio_check'));
          send({id:m.id,result:{thread:{id:'test-thread'},model:m.params.model,reasoningEffort:m.params.config.model_reasoning_effort}});
        }
        if(m.method==='turn/start') {
          send({id:m.id,result:{}});
          send({id:'read',method:'item/tool/call',params:{threadId:'test-thread',tool:'studio_read',arguments:{path:'probe.txt'}}});
        }
        if(m.id==='read') {
          assert.equal(m.result.success,true);
          assert.match(m.result.contentItems[0].text,/studio tool bridge works/);
          send({method:'item/completed',params:{item:{type:'agentMessage',text:'bridge OK',phase:'final_answer'}}});
          send({method:'turn/completed',params:{turn:{status:'completed'}}});
        }
      } catch(e) {send({id:m.id,error:{message:e.message}});process.exit(1);}
    });
  `);
  try {
    process.env.MOOOTION_CODEX_BIN = fixture;
    const job = {} as any;
    const result = await runCodex({projectId:id,prompt:'Read probe.txt',contract:'Technical test',signal:AbortSignal.timeout(15000),job,push:()=>{}}, async () => ({ready:true,image:'fixture'}));
    assert.equal(result.summary,'bridge OK');
    assert.equal(job.model,'gpt-6-astra');
  } finally {
    if(previous===undefined) delete process.env.MOOOTION_CODEX_BIN; else process.env.MOOOTION_CODEX_BIN=previous;
    await fs.rm(base,{recursive:true,force:true});
    await fs.rm(dir,{recursive:true,force:true});
  }
});
