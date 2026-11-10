import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ProjectSchema} from '../runtime/manifest';
import {projectDir} from './paths';
import {selectMotionRecipes,choreographyReview,codexChoreographyContext} from './codex-choreography';
const fixture=(id='test')=>ProjectSchema.parse({id,title:'Mail UI',width:1080,height:1080,fps:60,template:'screen',screen:{figmaUrl:'https://www.figma.com/design/Test/?node-id=1-2',background:{type:'fill',colors:['#000']},preset:'dribbble',intensity:2,variants:1,mockup:{material:'crystal',file:'x.png',size:[454,872],screen:{x:1,y:1,w:400,h:800,r:40}}},scenes:[{id:'v-1',title:'test',duration:4,groups:[],actions:[]}]});
test('Recipe selection uses project direction and specific user intent',()=>{
 const p=fixture();
 assert.ok(selectMotionRecipes(p,'мокап камера keynote').some(r=>r.id==='hero-camera'));
 assert.ok(selectMotionRecipes(p,'контейнер письмо перекрытие').some(r=>r.id==='container-content'));
 assert.equal(selectMotionRecipes(p,'').length,3);
});
test('Motion review flags blanket masks and static hero without forbidding intentional designs',()=>{
 const p=fixture();const scene=p.scenes[0];
 scene.actions=Array.from({length:4},(_,i)=>({id:'a'+i,title:'mask',layer:'Письма',effect:'appear.maskReveal',start:i*.1,duration:.5,curve:{type:'bezier' as const,v:[0,0,1,1] as [number,number,number,number]},params:{}}));
 const result=choreographyReview(p,false);
 assert.equal(result.warnings.length,4);
 scene.actions.push({...scene.actions[0],id:'hero',layer:'0 · Телефон',effect:'transform.move'});
 assert.equal(choreographyReview(p,true).warnings.some(s=>s.includes('нет движения мокапа')),false);
});
test('Codex restores missing brief transparently, persists selected context and preserves original brief',async()=>{
 const id='zz-motion-test-'+Date.now().toString(36);const dir=projectDir(id);
 try {
  const p=fixture(id);const c=await codexChoreographyContext(p,'Без масок, вход мокапа');
  const file=path.join(dir,'.moootion','brief.md');
  assert.match(await fs.readFile(file,'utf8'),/оригинальный бриф отсутствовал/);
  assert.match(c,/Сразу собирай и анимируй в одном запуске/);
  assert.match(c,/Число фаз свободное/);
  assert.doesNotMatch(c,/На этапе поз движение не реализуй/);
  assert.match(c,/studio_motion_review/);
  assert.match(await fs.readFile(path.join(dir,'.moootion','codex-motion-context.md'),'utf8'),/hero-camera/);
  await fs.writeFile(file,'Оригинальный пользовательский бриф');
  await codexChoreographyContext(p,'новая правка');
  assert.equal(await fs.readFile(file,'utf8'),'Оригинальный пользовательский бриф');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
