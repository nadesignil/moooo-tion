import test from 'node:test';
import assert from 'node:assert/strict';
import {connectionFeedback} from './connection-feedback';
import {connectionFailure, type ConnectionStatus} from '../runtime/connection-status';

test('Codex retries are visible and recovery requires actual model activity', () => {
  const events: ConnectionStatus[] = [];
  const feedback = connectionFeedback(s => events.push(s), () => 100);
  feedback.activity();
  assert.equal(events.length, 0); // Silence never establishes a lost connection.
  feedback.error('stream disconnected', true);
  assert.equal(events.at(-1)?.state, 'retrying');
  feedback.activity();
  assert.equal(events.at(-1)?.state, 'connected');
  feedback.activity();
  assert.equal(events.length, 2);
  assert.match(feedback.error('workspace routing discovery failed', false), /Запуск прерван/);
  assert.equal(events.at(-1)?.state, 'failed');
});

test('connector success, returned errors and timeouts remain distinct without replaying calls', async () => {
  const events: ConnectionStatus[] = [];
  const feedback = connectionFeedback(s => events.push(s));
  let calls = 0;
  await assert.rejects(feedback.connector('Figma','get_screenshot', async () => {calls++; throw new Error('Codex не ответил: mcpServer/tool/call');}));
  assert.equal(calls, 1);
  assert.deepEqual(events.map(e => e.state), ['waiting','failed']);
  assert.match(events[1].message, /Figma: время ожидания/);
  assert.match(events[1].message, /не подтверждает потерю интернета/);
  await feedback.connector('Magnific','images_generate',async () => ({isError:true}));
  assert.equal(events.at(-1)?.state, 'failed');
  await feedback.connector('Figma','get_metadata',async () => ({isError:false}));
  assert.equal(events.at(-1)?.state, 'connected');
  assert.match(connectionFailure('Codex','Соединение с Codex закрыто'), /Связь с Codex потеряна/);
});
