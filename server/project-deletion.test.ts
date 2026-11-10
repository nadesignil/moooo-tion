import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {deleteProjectFiles,renderBelongsToProject} from './project-deletion';

test('exact project ownership excludes prefix neighbours',()=>{
 assert.equal(renderBelongsToProject('demo-1794216612409.mp4','demo'),true);
 assert.equal(renderBelongsToProject('demo-1794216612409-variant-1.mp4','demo'),true);
 assert.equal(renderBelongsToProject('demo-copy-1794216612409.mp4','demo'),false);
 assert.equal(renderBelongsToProject('demo-not-a-render.mp4','demo'),false);
});
test('deletes project, its renders and legacy archives while preserving neighbours',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'moootion-delete-test-'));
 const storage={projects:path.join(root,'projects'),renders:[path.join(root,'renders'),path.join(root,'legacy')],trash:path.join(root,'trash')};
 try {
  for(const dir of [storage.projects,...storage.renders,storage.trash])await fs.mkdir(dir,{recursive:true});
  for(const id of ['demo','demo-copy']){await fs.mkdir(path.join(storage.projects,id));await fs.writeFile(path.join(storage.projects,id,'project.json'),JSON.stringify({id}));}
  for(const dir of storage.renders)for(const id of ['demo','demo-copy'])await fs.writeFile(path.join(dir,`${id}-1794216612409-variant.mp4`),'test');
  for(const [name,id]of [['demo-2026-11-09T00-00-00Z','demo'],['demo-2026-11-09T01-00-00Z','other']]){const dir=path.join(storage.trash,name);await fs.mkdir(dir);await fs.writeFile(path.join(dir,'project.json'),JSON.stringify({id}));}
  const result=await deleteProjectFiles('demo',storage);assert.deepEqual(result,{removedRenders:2,removedArchives:1});
  await assert.rejects(fs.access(path.join(storage.projects,'demo')));
  await fs.access(path.join(storage.projects,'demo-copy','project.json'));
  for(const dir of storage.renders)await fs.access(path.join(dir,'demo-copy-1794216612409-variant.mp4'));
  await fs.access(path.join(storage.trash,'demo-2026-11-09T01-00-00Z'));
  await assert.rejects(deleteProjectFiles('../demo-copy',storage));
  assert.deepEqual(await deleteProjectFiles('demo',storage),{removedRenders:0,removedArchives:0});
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
