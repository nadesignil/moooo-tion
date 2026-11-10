import test from 'node:test';
import assert from 'node:assert/strict';
import {startDesktopWithFallback} from './docker-desktop-start';

test('working CLI does not launch another Desktop instance',async()=>{
  await startDesktopWithFallback({cli:async()=>{},candidates:['desktop'],exists:async()=>{throw Error('unexpected');},launch:async()=>{throw Error('unexpected');}});
});
test('missing registry uses installed executable; absent executable preserves failure',async()=>{
  const launches:string[]=[];
  const options={cli:async()=>{throw Error('registry missing');},candidates:['absent','desktop'],exists:async(p:string)=>p==='desktop',launch:async(p:string)=>{launches.push(p);}};
  await startDesktopWithFallback(options); assert.deepEqual(launches,['desktop']);
  await assert.rejects(startDesktopWithFallback({...options,exists:async()=>false}),/registry missing/);
  await assert.rejects(startDesktopWithFallback({...options,launch:async()=>{throw Error('launch denied');}}),/launch denied/);
});
