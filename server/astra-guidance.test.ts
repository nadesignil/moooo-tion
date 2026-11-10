import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolveCodexGuidance, codexGuidanceContract} from './astra-guidance';
import {correctiveContract} from './corrective-contract';
import {studioContract} from './agent-prompt';

test('Astra selects method 13 while other models and explicit experiment profiles keep their contract', async () => {
  assert.equal(resolveCodexGuidance('gpt-6-astra'), 'method-13');
  assert.equal(resolveCodexGuidance('gpt-6-astra-preview'), 'method-13');
  assert.equal(resolveCodexGuidance('gpt-6-sol'), 'legacy');
  assert.equal(resolveCodexGuidance('gpt-6-astra', 'corrective'), 'corrective');
  assert.equal(resolveCodexGuidance('gpt-6-astra', 'legacy'), 'legacy');
  assert.throws(() => resolveCodexGuidance('gpt-6-astra', 'typo'));
  assert.equal(await codexGuidanceContract('test', 'original', 'legacy'), 'original');
  assert.equal(await codexGuidanceContract('test', 'original', 'corrective'), correctiveContract('test'));
});

test('method 13 preserves the exact tested instructions and replaces legacy creative guidance', async () => {
  const bytes = await fs.readFile(new URL('../rules/astra-method-13.md', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '07a2ed41bbf1624f7ac552847e24d72f57c5ac58753d4754a987726ce49dfc5b');
  const contract = await codexGuidanceContract('test', 'legacy creative recipe', 'method-13');
  assert.equal(contract, correctiveContract('test') + '\n' + bytes.toString('utf8'));
  assert.ok(!contract.includes('legacy creative recipe'));
  assert.ok(contract.includes('Принимай интервал как целое'));
});

test('method 13 retains project settings, assets and conversation without legacy creative instructions', async () => {
  const base = studioContract('test');
  const context = '\n## Project context\nstyle=custom; music.from=12.74; assets=local; user: retain the title';
  const actual = await codexGuidanceContract('test', base + context, 'method-13');
  assert.ok(actual.endsWith(context));
  assert.ok(!actual.includes('# Ты — моушн-дизайнер студии Moootion'));
  assert.ok(actual.includes('Принимай интервал как целое'));
});