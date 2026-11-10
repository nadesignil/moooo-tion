import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {parseFigmaUrl,classifyFigmaError,mcpResultText} from './figma-input';
import {readShared} from './project-tools';

test('Figma URLs require an exact trusted host and node; encoded node ids normalize',()=>{
  assert.deepEqual(parseFigmaUrl('https://www.figma.com/design/AbC123/Test?node-id=1%3A2&t=tracking'),{fileKey:'AbC123',nodeId:'1:2',url:'https://www.figma.com/design/AbC123/?node-id=1-2'});
  for(const u of ['https://www.figma.com.evil.test/design/AbC?node-id=1-2','https://www.figma.com/design/AbC','http://figma.com/design/AbC?node-id=1-2'])assert.throws(()=>parseFigmaUrl(u));
});
test('Figma errors distinguish auth, file access, missing node and limits',()=>{
  assert.equal(classifyFigmaError('HTTP 401'),'needs-auth');assert.equal(classifyFigmaError('HTTP 403'),'forbidden');assert.equal(classifyFigmaError('HTTP 404'),'not-found');assert.equal(classifyFigmaError('HTTP 429'),'rate-limited');
  assert.match(mcpResultText({structuredContent:{node:'1:2'}}),/1:2/);
});
test('Shared references cannot traverse into user projects',async()=>{
  await assert.rejects(readShared('runtime/../projects/testcdx/project.json'));
  await assert.rejects(readShared('templates/demo/../../projects/testcdx/project.json'));
  assert.match((await readShared('runtime/mockup.tsx')).text??'',/DeviceMockup/);
});
test('Figma package is captured before inference, retains structured data and is reusable offline',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'moootion-figma-input-'));
  const fake=path.join(dir,'fake-codex.mjs');const script=path.join(dir,'check.mts');
  const projectId=`zz-figma-fixture-${Date.now().toString(36)}`;
  const project=path.join(import.meta.dirname,'../projects',projectId);
  await fs.mkdir(project,{recursive:true});
  await fs.writeFile(fake,`
    import {createInterface} from 'node:readline';
    const send=(id,result)=>process.stdout.write(JSON.stringify({id,result})+'\\n');
    createInterface({input:process.stdin}).on('line',l=>{
      const m=JSON.parse(l);
      if(m.method==='initialize')send(m.id,{});
      if(m.method==='config/read')send(m.id,{config:{mcp_servers:{}}});
      if(m.method==='thread/start')send(m.id,{thread:{id:'fixture'}});
      if(m.method==='turn/start')process.exit(8);
      if(m.method==='mcpServerStatus/list'){
        const tools=Object.fromEntries(['get_metadata','get_design_context','get_screenshot','get_variable_defs'].map(name=>[name,{name,inputSchema:{type:'object',properties:{fileKey:{type:'string'},nodeId:{type:'string'}},required:['fileKey','nodeId']}}]));
        send(m.id,{data:[{name:m.params.serverName,authStatus:'oAuth',tools:m.params.serverName==='moootion_figma'?tools:{}}]});
      }
      if(m.method==='mcpServer/tool/call'){
        if(m.params.arguments.nodeId!=='1:2')process.exit(9);
        send(m.id,m.params.tool==='get_screenshot'?{content:[{type:'image',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII='}]}:{content:[{type:'text',text:'Screen metadata and layout'}],structuredContent:{nodeId:'1:2',width:409,height:893}});
      }
    });
  `);
  const inputUrl=pathToFileURL(path.join(import.meta.dirname,'figma-input.ts')).href;
  const settingsUrl=pathToFileURL(path.join(import.meta.dirname,'settings.ts')).href;
  await fs.writeFile(script,`
    process.env.MOOOTION_CODEX_BIN=${JSON.stringify(fake)};
    const settings=await import(${JSON.stringify(settingsUrl)});
    if((await settings.readSettings()).figmaToken) {console.log(JSON.stringify({skip:'REST token configured'}));process.exit(0);}
    const m=await import(${JSON.stringify(inputUrl)});
    const url='https://www.figma.com/design/AbC123/fixture?node-id=1-2';
    const check=await m.checkFigma(url);
    const packet=await m.prepareFigma(${JSON.stringify(projectId)},url,new AbortController().signal);
    const cached=await m.prepareFigma(${JSON.stringify(projectId)},url,new AbortController().signal);
    console.log(JSON.stringify({check,packet,cachedAt:cached.capturedAt}));process.exit(0);
  `);
  try {
    const loader=pathToFileURL(path.join(import.meta.dirname,'../node_modules/tsx/dist/loader.mjs')).href;
    const {stdout}=await promisify(execFile)(process.execPath,['--import',loader,script],{timeout:20000,windowsHide:true});
    const r=JSON.parse(stdout.trim());if(r.skip)return;
    assert.equal(r.check.ok,true);assert.equal(r.packet.complete,true);assert.equal(r.packet.capturedAt,r.cachedAt);
    assert.ok(r.packet.files.includes('reference.png'));assert.ok(r.packet.files.includes('design-context.txt'));
    const metadata=await fs.readFile(path.join(project,r.packet.directory,'metadata.json'),'utf8');assert.match(metadata,/structuredContent/);
  } finally {await fs.rm(project,{recursive:true,force:true});await fs.rm(dir,{recursive:true,force:true});}
});

import {figmaAssetUrls} from './figma-input';
test('Figma source assets exclude documentation, example URLs and transport metadata',()=>{
 const real='https://www.figma.com/api/mcp/asset/real.png';
 const sample='https://www.figma.com/api/mcp/asset/sample.png';
 const urls=figmaAssetUrls([{content:[{type:'text',text:`const img="${real}";`},{type:'text',text:`Example: ${sample}`}],_meta:{websiteUrl:'https://developers.figma.com/docs/figma-mcp-server/'}}]);
 assert.deepEqual([...urls],[real]);
});
