import test from 'node:test';
import assert from 'node:assert/strict';
import {selectCodexPolicy, readCodexPolicy} from './codex-policy';
const model = (name: string, efforts: string[], isDefault = false) => ({model: name, isDefault, supportedReasoningEfforts: efforts.map(reasoningEffort => ({reasoningEffort}))});
const sol = model('gpt-6.1-sol', ['low','high','max','ultra'], true);
const astra = model('gpt-6-astra', ['low','medium','high','xhigh','max','ultra']);
test('quality default selects Astra Max even when account default is Sol', () => {
  assert.deepEqual(selectCodexPolicy([sol,astra]), {model:'gpt-6-astra',effort:'max',source:'studio-default'});
  assert.throws(() => selectCodexPolicy([sol]), /Автоматическая замена отключена/);
});
test('explicit experiment overrides survive, unsupported choices fail instead of changing silently', () => {
  assert.deepEqual(selectCodexPolicy([sol,astra], {model:sol.model,reasoningEffort:'high'}), {model:sol.model,effort:'high',source:'project-override'});
  assert.throws(() => selectCodexPolicy([astra], {model:'missing'}), /недоступна/);
  assert.throws(() => selectCodexPolicy([astra], {reasoningEffort:'ultra'}), /уровень/);
  assert.throws(() => selectCodexPolicy([astra], {reasoningEffort:'unknown'}), /уровень/);
});
test('only advertised single-agent efforts are selected', () => {
  assert.equal(selectCodexPolicy([model(astra.model,['low','high','ultra'])]).effort,'high');
  assert.throws(() => selectCodexPolicy([model(astra.model,[])]), /уровень/);
});
test('model discovery reads subsequent pages and detects repeated cursors', async () => {
  const calls: unknown[]=[];
  const policy=await readCodexPolicy({request:async(method,params:any)=>{calls.push(params);return params.cursor ? {data:[astra],nextCursor:null} : {data:[sol],nextCursor:'second'};}});
  assert.equal(policy.model,astra.model); assert.deepEqual(calls,[{limit:100},{limit:100,cursor:'second'}]);
  await assert.rejects(readCodexPolicy({request:async()=>({data:[sol],nextCursor:'loop'})}), /повторил/);
});
