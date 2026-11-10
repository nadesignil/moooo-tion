import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT} from './paths';
import {initializeProvider, readJson} from '../tools/provider-context.mjs';

// Local studio settings. Secrets stay on disk on this machine and are never
// sent back to the browser — the client only learns whether they are set.
const FILE = path.join(ROOT, '.moootion', 'settings.json');

/** fastPath: small edits first go to the fast model, which may only touch project.json */
/** claudeVerifiedAt: the agent answered once on this machine (macOS fallback when the Keychain entry is not found) */
/** agentModel: the model of the main agent runs (the user picks it; the fast path keeps its own model) */
export type AgentProvider = 'claude' | 'codex';
type Settings = {agentProvider?: AgentProvider; codexVerifiedAt?: string; figmaToken?: string; fastPath?: boolean; claudeVerifiedAt?: string; agentModel?: string};

export const AGENT_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5'] as const;
export const DEFAULT_AGENT_MODEL = AGENT_MODELS[0];

export const readSettings = async (): Promise<Settings> => {
  const saved = await readJson(FILE) as Settings;
  if (saved.agentProvider === 'codex' || saved.agentProvider === 'claude') return saved;
  await initializeProvider(ROOT);
  return await readJson(FILE) as Settings;
};

export const agentModel = (s: Settings) => (s.agentModel && (AGENT_MODELS as readonly string[]).includes(s.agentModel) ? s.agentModel : DEFAULT_AGENT_MODEL);

export const publicSettings = async () => {
  const s = await readSettings();
  return {agentProvider: s.agentProvider === 'codex' ? 'codex' : 'claude', codexVerifiedAt: s.codexVerifiedAt ?? null, figmaToken: Boolean(s.figmaToken), fastPath: s.fastPath !== false, agentModel: agentModel(s)};
};

export const updateSettings = async (patch: Settings) => {
  const cur = await readSettings();
  const next: Settings = {...cur};
  if (typeof patch.figmaToken === 'string') {
    const t = patch.figmaToken.trim();
    if (t) next.figmaToken = t;
    else delete next.figmaToken;
  }
  if (patch.agentProvider === 'codex' || patch.agentProvider === 'claude') next.agentProvider = patch.agentProvider;
  if (typeof patch.codexVerifiedAt === 'string') next.codexVerifiedAt = patch.codexVerifiedAt;
  if (typeof patch.fastPath === 'boolean') next.fastPath = patch.fastPath;
  if (typeof patch.claudeVerifiedAt === 'string') next.claudeVerifiedAt = patch.claudeVerifiedAt;
  if (typeof patch.agentModel === 'string' && (AGENT_MODELS as readonly string[]).includes(patch.agentModel)) next.agentModel = patch.agentModel;
  await fs.mkdir(path.dirname(FILE), {recursive: true});
  await fs.writeFile(FILE, JSON.stringify(next, null, 2), 'utf8');
  return publicSettings();
};
