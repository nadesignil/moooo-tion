import {mediaFrames} from './project-tools';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {PNG} from 'pngjs';
import {ROOT,projectDir} from './paths';
import {contactSheet,composeImages,transformImage,maskImage,differenceMask,transcodeMedia} from './codex-media-workbench';

test('media workbench: exact layout, masks, codec conversion, isolation and cancellation',async()=>{
 const id='zz-workbench-'+randomUUID(),root=projectDir(id),signal=new AbortController().signal;
 await fs.mkdir(root);const red=new PNG({width:16,height:16}),blue=new PNG({width:16,height:16});
 for(let i=0;i<red.data.length;i+=4){red.data.set([255,0,0,255],i);blue.data.set([0,0,255,255],i);}
 const read=async(file:string)=>PNG.sync.read(await fs.readFile(path.join(root,file)));
 try{
  await fs.writeFile(path.join(root,'red.png'),PNG.sync.write(red));await fs.writeFile(path.join(root,'blue.png'),PNG.sync.write(blue));
  const sheet=await contactSheet(id,{paths:['red.png','blue.png'],columns:2,cellWidth:64,cellHeight:64},signal);
  const img=await read(sheet.path);assert.equal(img.width,128);assert.equal(img.height,64);assert.deepEqual([...img.data.subarray(0,4)],[255,0,0,255]);assert.deepEqual([...img.data.subarray(64*4,64*4+4)],[0,0,255,255]);
  const composed=await composeImages(id,{width:16,height:16,layers:[{path:'red.png',x:0,y:0,width:16,height:16},{path:'blue.png',x:0,y:0,width:16,height:16,opacity:.5}]},signal);
  assert.deepEqual([...(await read(composed.path)).data.subarray(0,4)],[128,0,128,255]);
  const mask=await differenceMask(id,{a:'red.png',b:'red.png',threshold:0},signal);
  const hidden=await maskImage(id,{path:'red.png',mask:mask.path,mode:'luminance'},signal);assert.equal((await read(hidden.path)).data[3],0);
  const visible=await maskImage(id,{path:'red.png',mask:mask.path,mode:'luminance',invert:true},signal);assert.equal((await read(visible.path)).data[3],255);
  const resized=await transformImage(id,{path:'red.png',width:32},signal);assert.equal((await read(resized.path)).width,32);assert.equal((await read(resized.path)).height,32);
  await assert.rejects(contactSheet(id,{paths:['../other.png'],columns:1,cellWidth:64,cellHeight:64},signal),/вне папки/);
  await assert.rejects(transformImage(id,{path:'https://example.com/a.png'},signal));
  const abort=new AbortController();abort.abort();await assert.rejects(contactSheet(id,{paths:['red.png'],columns:1,cellWidth:64,cellHeight:64},abort.signal),/stopped/);
  await promisify(execFile)(process.execPath,[path.join(ROOT,'node_modules/@remotion/cli/remotion-cli.js'),'ffmpeg','-hide_banner','-loglevel','error','-loop','1','-i',path.join(root,'red.png'),'-f','lavfi','-i','sine=frequency=440','-t','0.3','-c:a','aac','-c:v','libx264',path.join(root,'source.mp4')],{windowsHide:true,timeout:30000});
  const video=await transcodeMedia(id,{path:'source.mp4',seconds:.2,width:16,fps:10,speed:.25,mute:false},signal);assert.ok((await fs.stat(path.join(root,video.path))).size>0);
  const frame=path.join(root,'decoded.png');await promisify(execFile)(process.execPath,[path.join(ROOT,'node_modules/@remotion/cli/remotion-cli.js'),'ffmpeg','-hide_banner','-loglevel','error','-i',path.join(root,video.path),'-frames:v','1',frame],{windowsHide:true,timeout:30000});assert.equal((await read('decoded.png')).width,16);
  const frames=await Promise.all([mediaFrames(id,'source.mp4',[0],signal,32),mediaFrames(id,'source.mp4',[0],signal,32)]);assert.notEqual(frames[0].frames[0],frames[1].frames[0]);assert.equal((await read(frames[0].frames[0])).width,32);
 }finally{assert.equal(path.dirname(root),path.join(ROOT,'projects'));assert.ok(id.startsWith('zz-workbench-'));await fs.rm(root,{recursive:true,force:true});}
});
