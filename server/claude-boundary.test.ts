import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {projectDir} from './paths';

test('Claude keeps its SDK contract and tools and never enters Codex preparation',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'moootion-claude-boundary-'));
 const script=path.join(dir,'check.mts');const id=`zz-claude-regression-${Date.now().toString(36)}`;const project=projectDir(id);await fs.mkdir(project,{recursive:true});
 const manifest={id,title:'test',width:1080,height:1080,fps:60,template:'screen',screen:{figmaUrl:'https://www.figma.com/design/UnavailableNodeFixture123/fixture?node-id=1-2'},scenes:[{id:'v-1',title:'test',duration:4,groups:[],actions:[]}]};
 await fs.writeFile(path.join(project,'project.json'),JSON.stringify(manifest));
 const sdk=`export function query({options}){globalThis.__claudeOptions=options;return(async function*(){yield {type:'system',subtype:'init',model:'claude-opus-5-5'};yield {type:'result',subtype:'success',result:'Claude fixture completed',usage:{},num_turns:1};})();}`;
 const settings=`export const readSettings=async()=>({agentProvider:'claude',fastPath:true,agentModel:'claude-opus-5-5'});export const agentModel=s=>s.agentModel;export const updateSettings=async()=>({});`;
 const git=`export const snapshot=async()=> 'fixture';export const restore=async()=>{};`;
 const data=(s:string)=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
 const jobsUrl=pathToFileURL(path.join(import.meta.dirname,'jobs.ts')).href;
 await fs.writeFile(script,`
  import {registerHooks} from 'node:module';
  registerHooks({resolve(specifier,context,next){
   if(specifier==='@anthropic-ai/claude-agent-sdk')return {url:${JSON.stringify(data(sdk))},shortCircuit:true};
   if(context.parentURL?.includes('/server/jobs.ts')&&specifier==='./settings')return {url:${JSON.stringify(data(settings))},shortCircuit:true};
   if(context.parentURL?.includes('/server/jobs.ts')&&specifier==='./git')return {url:${JSON.stringify(data(git))},shortCircuit:true};
   if(context.parentURL?.includes('/server/jobs.ts')&&/figma-input|codex-run|project-tools/.test(specifier))throw new Error('Claude entered a Codex-only path');
   return next(specifier,context);
  }});
  const {startJob,getJob}=await import(${JSON.stringify(jobsUrl)});
  const job=await startJob({projectId:${JSON.stringify(id)},sceneId:null,kind:'create',title:'Claude regression',prompt:'Preserve existing Claude workflow'});
  const started=Date.now();while(getJob(job.id).status==='running'&&Date.now()-started<10000)await new Promise(r=>setTimeout(r,20));
  const options=globalThis.__claudeOptions;
  const shell=await options.canUseTool('Bash',{command:'echo regression'});
  const figma=await options.canUseTool('mcp__claude_ai_Figma__get_metadata',{nodeId:'1:2'});
  console.log(JSON.stringify({status:getJob(job.id).status,model:options.model,allowedTools:options.allowedTools,shell:shell.behavior,figma:figma.behavior,hasOriginalContract:options.systemPrompt.append.includes('Ты — моушн-дизайнер студии Moootion'),hasCodexPreparation:options.systemPrompt.append.includes('Подготовленные исходники Figma')}));
  process.exit(0);
 `);
 try{
  const loader=pathToFileURL(path.join(import.meta.dirname,'../node_modules/tsx/dist/loader.mjs')).href;
  const {stdout}=await promisify(execFile)(process.execPath,['--import',loader,script],{timeout:15000,windowsHide:true});
  const r=JSON.parse(stdout.trim());assert.equal(r.status,'done');assert.equal(r.model,'claude-opus-5-5');assert.deepEqual(r.allowedTools,['TodoWrite','WebFetch']);assert.equal(r.shell,'allow');assert.equal(r.figma,'allow');assert.equal(r.hasOriginalContract,true);assert.equal(r.hasCodexPreparation,false);
 }finally{await fs.rm(project,{recursive:true,force:true});await fs.rm(dir,{recursive:true,force:true});}
});
