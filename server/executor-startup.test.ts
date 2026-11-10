import test from 'node:test';
import assert from 'node:assert/strict';
import {createExecutorStartup,waitForExecutor} from './executor-startup';

const ready={ready:true,image:'fixture',imageId:'sha256:'+'a'.repeat(64)};
const missing={ready:false,image:'fixture',code:'image-missing'};
const stopped={ready:false,image:'fixture',code:'engine-unavailable',reason:'engine unavailable'};
const fixture=(statuses:any[])=>{
 let time=0; const calls:string[]=[];
 const deps={status:async()=>{calls.push('status');return statuses.length>1?statuses.shift():statuses[0];},start:async()=>{calls.push('start');},build:async()=>{calls.push('build');},diagnostic:async():Promise<string|undefined>=>undefined,wait:async()=>{time+=10;},now:()=>time,timeoutMs:20,log:()=>{}};
 return {deps,calls};
};
test('ready engine and image are reused without starting Desktop or rebuilding',async()=>{
 const {deps,calls}=fixture([ready]);const app=createExecutorStartup(deps);
 assert.equal((await app.ensure()).ready,true);assert.deepEqual(calls,['status']);assert.equal(app.state().phase,'ready');
});
test('concurrent callers share startup, wait for Linux and build the missing image once',async()=>{
 const {deps,calls}=fixture([stopped,stopped,missing,ready]);const app=createExecutorStartup(deps);
 const [a,b]=await Promise.all([app.ensure(),app.ensure()]);assert.equal(a.ready,true);assert.deepEqual(a,b);
 assert.equal(calls.filter(x=>x==='start').length,1);assert.equal(calls.filter(x=>x==='build').length,1);
});
test('missing image on a running daemon builds without restarting Docker',async()=>{
 const {deps,calls}=fixture([missing,ready]);await createExecutorStartup(deps).ensure();assert.equal(calls.includes('start'),false);assert.equal(calls.includes('build'),true);
});
test('reboot requirement, wrong engine and build failure remain explicit failures',async()=>{
 const f=fixture([stopped]);f.deps.diagnostic=async()=> 'reboot required';const app=createExecutorStartup(f.deps);
 assert.equal((await app.ensure()).reason,'reboot required');assert.equal(app.state().phase,'unavailable');assert.equal(f.calls.includes('build'),false);
 const wrong=fixture([{...stopped,code:'wrong-engine',reason:'Linux required'}]);assert.equal((await createExecutorStartup(wrong.deps).ensure()).reason,'Linux required');assert.equal(wrong.calls.includes('start'),false);
 const bad=fixture([missing]);bad.deps.build=async()=>{throw new Error('build failed');};assert.equal((await createExecutorStartup(bad.deps).ensure()).reason,'build failed');
});
test('engine startup times out instead of blocking agents indefinitely',async()=>{
 const f=fixture([stopped]);assert.equal((await createExecutorStartup(f.deps).ensure()).ready,false);assert.equal(f.calls.includes('build'),false);
});
test('cancelling one project does not cancel shared executor preparation',async()=>{
 let complete!:(value:typeof ready)=>void;const pending=new Promise<typeof ready>(r=>{complete=r;});
 const a=new AbortController(),b=new AbortController();
 const first=waitForExecutor(a.signal,()=>pending),second=waitForExecutor(b.signal,()=>pending);
 a.abort();await assert.rejects(first,/stopped/);complete(ready);assert.equal((await second).ready,true);
 await assert.rejects(waitForExecutor(a.signal,()=>{throw new Error('must not run');}),/stopped/);
});
