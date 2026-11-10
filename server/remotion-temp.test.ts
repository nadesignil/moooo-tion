import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import './remotion-temp';
import {ROOT,RENDERS,REMOTION_TEMP} from './paths';
test('Remotion scratch space and output stay under workspace temp',()=>{
 assert.equal(os.tmpdir(),REMOTION_TEMP);
 for(const key of ['TEMP','TMP','TMPDIR'])assert.equal(process.env[key],REMOTION_TEMP);
 assert.equal(RENDERS,path.join(ROOT,'temp','renders'));
});
