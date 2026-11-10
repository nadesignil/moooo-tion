import test from 'node:test';
import assert from 'node:assert/strict';
import {previewRange} from '../studio/src/previewRange';
import type {Project} from '../runtime/manifest';
const project = {template:'screen', fps:30, scenes:[{id:'a',duration:1.25},{id:'b',duration:2.25}]} as Project;
test('Variant preview retains global frames and full composition duration', () => {
  const range=previewRange(project,'b');
  assert.deepEqual(range,{from:38,to:105,total:106,bounded:true});
  assert.equal(project.scenes.length,2);
});
test('Whole-project, missing-scene and non-variant preview share render bounds', () => {
  for(const p of [project,{...project,template:'showreel'} as Project]) {
    assert.deepEqual(previewRange(p,null),{from:0,to:105,total:106,bounded:false});
  }
  assert.equal(previewRange(project,'missing').bounded,false);
});


test('Four-second variant exposes a local 240-frame clock and keeps its global offset', () => {
  const p={...project,fps:60,scenes:[{id:'a',duration:4},{id:'b',duration:4},{id:'c',duration:4}]} as Project;
  const second=previewRange(p,'b');
  assert.equal(second.to-second.from+1,240);
  assert.equal(second.from,240);
  assert.equal(second.total,720);
  assert.equal((second.from+120)/60,6);
  assert.equal((second.from+120-second.from)/60,2);
});
