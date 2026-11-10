import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {PNG} from 'pngjs';
import {projectDir} from './paths';
import {cropImage,compareImages,patchProject,searchProject} from './project-tools';

test('Codex image tools preserve real pixels and detect mismatches',async()=>{
 const id=`zz-pixels-${Date.now().toString(36)}`;const dir=projectDir(id);await fs.mkdir(dir,{recursive:true});
 try {
  const p=new PNG({width:2,height:2});p.data.fill(255);p.data[0]=0;
  await fs.writeFile(path.join(dir,'a.png'),PNG.sync.write(p));
  const signal=new AbortController().signal;
  const cropped=await cropImage(id,'a.png',{x:0,y:0,width:1,height:1},signal);
  const read=PNG.sync.read(await fs.readFile(path.join(dir,cropped.path)));
  assert.equal(read.width,1);assert.deepEqual([...read.data],[0,255,255,255]);
  assert.equal((await compareImages(id,'a.png','a.png',signal)).identical,true);
  p.data[0]=255;await fs.writeFile(path.join(dir,'b.png'),PNG.sync.write(p));
  const diff=await compareImages(id,'a.png','b.png',signal);assert.equal(diff.changedPixels,1);assert.equal(diff.identical,false);assert.ok(diff.rmse>0);
  await assert.rejects(cropImage(id,'a.png',{x:1,y:1,width:2,height:2},signal));
  await fs.writeFile(path.join(dir,'test.ts'),'const marker = 1;');
  assert.equal((await searchProject(id,'marker')).hits.length,1);
  await patchProject(id,'test.ts','marker = 1','marker = 2');assert.match(await fs.readFile(path.join(dir,'test.ts'),'utf8'),/marker = 2/);
  await assert.rejects(patchProject(id,'../testcdx/project.json','x','y'));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
