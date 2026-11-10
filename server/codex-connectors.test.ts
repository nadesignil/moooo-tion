import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorId, connectorToolAllowed, magnificRead, guardedConnectorCall} from './codex-connectors';

test('Only the selected services and read-only Figma tools are exposed',()=>{
  assert.throws(()=>connectorId('untrusted'));
  for(const name of ['whoami','get_design_context','get_metadata','get_screenshot','get_variable_defs']) assert.equal(connectorToolAllowed('figma',name),true);
  for(const name of ['use_figma','create_new_file','delete_node','generate_image','send_code_to_figma']) assert.equal(connectorToolAllowed('figma',name),false);
});
test('Known Magnific read operations are free; generation, edits and unknown actions require approval',()=>{
  for(const name of ['account_balance','simulate_cost','images_models_list','creations_get','creations_wait']) assert.equal(magnificRead(name),true);
  for(const name of ['images_generate','video_generate','audio_music_generate','images_upscale','images_remove_background','generate_and_get','unknown_operation']) assert.equal(magnificRead(name),false);
});
test('Declining a paid call never reaches the MCP server; allowing sends it once',async()=>{
  let sends=0;
  const invoke=async()=>{sends++;return 'ok';};
  await assert.rejects(guardedConnectorCall('magnific','images_generate',{},invoke,async()=>false),/отклонил/);
  assert.equal(sends,0);
  await assert.rejects(guardedConnectorCall('magnific','images_generate',{},invoke),/отклонил/);
  assert.equal(sends,0);
  assert.equal(await guardedConnectorCall('magnific','images_generate',{},invoke,async()=>true),'ok');
  assert.equal(sends,1);
  await assert.rejects(guardedConnectorCall('figma','use_figma',{},invoke,async()=>true),/чтение/);
  assert.equal(sends,1);
  await guardedConnectorCall('magnific','simulate_cost',{},invoke);
  assert.equal(sends,2);
});

import {mediaUrlAllowed} from './codex-media';
test('Connector media excludes arbitrary URLs, local addresses, credentials and alternate ports',()=>{
  assert.equal(mediaUrlAllowed('https://cdn.magnific.com/output.png'),true);
  assert.equal(mediaUrlAllowed('https://s3.amazonaws.com/bucket/output.mp4'),true);
  for(const url of ['http://cdn.magnific.com/a.png','https://localhost/a','https://127.0.0.1/a','https://magnific.com.evil.test/a','https://user:pass@cdn.magnific.com/a','https://cdn.magnific.com:8443/a']) assert.equal(mediaUrlAllowed(url),false);
});

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';

test('MCP broker discovers schemas and invokes a tool over Codex JSON-RPC without a model turn', async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'moootion-mcp-protocol-'));
  const fake=path.join(dir,'fake-codex.mjs');
  const harness=path.join(dir,'check.mts');
  await fs.writeFile(fake,`
    import {createInterface} from 'node:readline';
    const send=(id,result)=>process.stdout.write(JSON.stringify({id,result})+'\\n');
    createInterface({input:process.stdin}).on('line',l=>{
      const m=JSON.parse(l);
      if(m.method==='initialize') send(m.id,{});
      if(m.method==='config/read') send(m.id,{config:{mcp_servers:{}}});
      if(m.method==='thread/start') send(m.id,{thread:{id:'broker-test'}});
      if(m.method==='turn/start') {process.stderr.write('MODEL TURN MUST NOT RUN');process.exit(7);}
      if(m.method==='mcpServerStatus/list') {
        const figma=m.params.serverName==='moootion_figma';
        const tools=figma ? {whoami:{name:'whoami',inputSchema:{type:'object'}},use_figma:{name:'use_figma',inputSchema:{type:'object'}}} : {account_balance:{name:'account_balance',inputSchema:{type:'object'}}};
        send(m.id,{data:[{name:m.params.serverName,authStatus:'oAuth',tools}],nextCursor:null});
      }
      if(m.method==='mcpServer/tool/call') send(m.id,{content:[{type:'text',text:'balance=100'}],isError:false});
    });
  `);
  const moduleUrl=pathToFileURL(path.join(import.meta.dirname,'codex-connectors.ts')).href;
  await fs.writeFile(harness,`
    process.env.MOOOTION_CODEX_BIN=${JSON.stringify(fake)};
    const m=await import(${JSON.stringify(moduleUrl)});
    const status=await m.codexConnectorsStatus(true);
    const tools=await m.codexConnectorTools('figma');
    const result=await m.callCodexConnector('magnific','account_balance',{});
    let denied=false; try {await m.callCodexConnector('figma','use_figma',{});} catch {denied=true;}
    console.log(JSON.stringify({status,tools,result,denied}));
    process.exit(0);
  `);
  try {
    const loader=pathToFileURL(path.join(import.meta.dirname,'../node_modules/tsx/dist/loader.mjs')).href;
    const {stdout}=await promisify(execFile)(process.execPath,['--import',loader,harness],{timeout:20000,windowsHide:true});
    const r=JSON.parse(stdout.trim());
    assert.equal(r.status.connectors.every((c:any)=>c.status==='connected'),true);
    assert.deepEqual(r.tools.map((t:any)=>t.name),['whoami']);
    assert.equal(r.result.content[0].text,'balance=100');
    assert.equal(r.denied,true);
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});

import {exactCostEstimate} from './codex-connectors';
test('Codex cost cards use only the exact simulated tool and arguments',()=>{
 const estimates=[{input:JSON.stringify({tool:'images_generate',arguments:{prompt:'apple',mode:'fast',count:1}}),text:'1 credit'},{input:JSON.stringify({tool:'images_generate',arguments:{prompt:'apple',mode:'expensive',count:1}}),text:'50 credits'}];
 assert.equal(exactCostEstimate(estimates,'images_generate',{count:1,mode:'fast',prompt:'apple'})?.text,'1 credit');
 assert.equal(exactCostEstimate(estimates,'images_generate',{count:2,mode:'fast',prompt:'apple'}),undefined);
 assert.equal(exactCostEstimate(estimates,'video_generate',{count:1,mode:'fast',prompt:'apple'}),undefined);
 assert.equal(connectorToolAllowed('magnific','trash_purge'),false);
});
