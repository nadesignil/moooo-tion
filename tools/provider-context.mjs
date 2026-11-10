import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export function normalizeProvider(value) {
  if (value == null || value === '') return null;
  const id = String(value).trim().toLowerCase();
  if (['codex', 'chatgpt', 'openai'].includes(id)) return 'codex';
  if (['claude', 'anthropic'].includes(id)) return 'claude';
  throw new Error('Провайдер должен быть codex (ChatGPT) или claude');
}
export function detectProvider(env = process.env) {
  const codex = Boolean(env.CODEX_THREAD_ID || env.CODEX_SESSION_ID || env.CODEX_APP_TOOLS_PIPE_PATH || /codex|chatgpt/i.test(env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE ?? ''));
  const claude = Boolean(env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT || env.CLAUDE_CODE_HOST_SESSION_ID || env.CLAUDE_CODE_CHILD_SESSION);
  // PATH and installed applications are not evidence of which assistant initiated setup.
  return codex === claude ? null : codex ? 'codex' : 'claude';
}
export function resolveProvider({explicit, saved, env = process.env} = {}) {
  return normalizeProvider(explicit ?? env.MOOOTION_PROVIDER ?? env.MOOOTION_INSTALL_SOURCE)
    ?? normalizeProvider(saved) ?? detectProvider(env);
}
export async function readJson(file, fallback = {}) {
  try {return JSON.parse(await fs.readFile(file, 'utf8'));}
  catch (error) {if (error.code === 'ENOENT') return fallback; throw error;}
}
export async function saveJson(file, value) {
  await fs.mkdir(path.dirname(file), {recursive:true});
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', {mode:0o600});
    // Windows can temporarily lock the destination while another startup probe reads it.
    // Keep the old file intact and retry the atomic replacement; never unlink settings.
    for (let attempt = 0; ; attempt++) {
      try {await fs.rename(temporary, file); break;}
      catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 7) throw error;
        await new Promise(resolve => setTimeout(resolve, 20 * 2 ** Math.min(attempt, 4)));
      }
    }
  } finally {await fs.rm(temporary, {force:true});}
}
export async function initializeProvider(root, {explicit, env = process.env} = {}) {
  const file = path.join(root, '.moootion', 'settings.json');
  const saved = await readJson(file);
  const provider = resolveProvider({explicit, saved:saved.agentProvider, env});
  if (provider && saved.agentProvider !== provider) await saveJson(file, {...saved, agentProvider:provider});
  return provider;
}
