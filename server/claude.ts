import {execFile} from 'node:child_process';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import {CLAUDE_HOME, ROOT} from './paths';

export type ClaudeStatus = {
  /** a Claude account login of Claude Code exists on this device */
  login: boolean;
  /** an API key is set in the environment */
  apiKey: boolean;
  /** the `claude` CLI is installed (needed once, to log in) */
  cli: boolean;
  /** last successful check (this server session) */
  verified: {at: string; model: string} | null;
};

let verified: ClaudeStatus['verified'] = null;

const require = createRequire(import.meta.url);

/** The Claude Code binary that ships with the Agent SDK for this platform — no separate install needed. */
export const bundledClaude = () => {
  try {
    const pkg = require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`);
    return path.join(path.dirname(pkg), process.platform === 'win32' ? 'claude.exe' : 'claude');
  } catch {
    return null;
  }
};

/** `claude auth status --json` of the bundled binary: same answer on every platform (the Mac Keychain included) */
const authStatus = () =>
  new Promise<{loggedIn: boolean; plan?: string} | null>((resolve) => {
    const bin = bundledClaude();
    if (!bin) return resolve(null);
    execFile(bin, ['auth', 'status', '--json'], {timeout: 15_000, env: agentEnv() as NodeJS.ProcessEnv}, (_err, stdout) => {
      try {
        const d = JSON.parse(stdout);
        // only the flag and the plan; the e-mail and organisation in the answer are not kept
        resolve({loggedIn: Boolean(d.loggedIn), plan: typeof d.subscriptionType === 'string' ? d.subscriptionType : undefined});
      } catch {
        resolve(null);
      }
    });
  });

/**
 * Only the presence of the account login is checked — token values are never read out.
 * Windows and Linux keep it in ~/.claude/.credentials.json; macOS keeps it in the Keychain, where only the
 * entry's existence is asked (`security find-generic-password` without -w does not print the secret).
 */
const hasAccountLogin = async () => {
  const st = await authStatus();
  if (st) return st.loggedIn;
  try {
    const raw = JSON.parse(await fs.readFile(path.join(CLAUDE_HOME, '.credentials.json'), 'utf8'));
    const oauth = raw?.claudeAiOauth;
    if (oauth && (oauth.refreshToken || oauth.accessToken)) return true;
  } catch {
    // no file — on a Mac that is normal
  }
  if (process.platform !== 'darwin') return false;
  const inKeychain = await new Promise<boolean>((resolve) => {
    execFile('security', ['find-generic-password', '-s', 'Claude Code-credentials'], (err) => resolve(!err));
  });
  if (inKeychain) return true;
  // the Keychain entry may be named differently in another Claude Code version: an earlier answer of the agent counts
  const {readSettings} = await import('./settings');
  return Boolean((await readSettings()).claudeVerifiedAt);
};

const hasCli = () =>
  new Promise<boolean>((resolve) => {
    execFile(process.platform === 'win32' ? 'where' : 'which', ['claude'], (err) => resolve(!err));
  });

export const claudeStatus = async (): Promise<ClaudeStatus> => {
  const [login, cli] = await Promise.all([hasAccountLogin(), hasCli()]);
  return {login, apiKey: Boolean(process.env.ANTHROPIC_API_KEY), cli: cli || Boolean(bundledClaude()), verified};
};

/**
 * Environment for the agent process. When the studio is started from inside
 * another Claude session (e.g. the desktop app) it inherits that session's
 * plumbing variables; the agent must use the device login instead.
 */
export const agentEnv = (): Record<string, string | undefined> => {
  const env: Record<string, string | undefined> = {...process.env};
  const insideHost = Boolean(env.CLAUDE_CODE_CHILD_SESSION || env.CLAUDE_CODE_HOST_SESSION_ID);
  for (const key of Object.keys(env)) {
    if (key === 'CLAUDECODE' || key === 'CLAUDE_PID' || key.startsWith('CLAUDE_CODE_') || key.startsWith('CLAUDE_AGENT_SDK_')) {
      delete env[key];
    }
  }
  // the host's local API proxy only works for the host's own sessions
  if (insideHost && env.ANTHROPIC_BASE_URL && /localhost|127\.0\.0\.1/.test(env.ANTHROPIC_BASE_URL)) {
    delete env.ANTHROPIC_BASE_URL;
  }
  return env;
};

const humanError = (raw: string) => {
  if (/not logged in|\/login|authentication|unauthorized|401/i.test(raw)) {
    return 'Claude Code не авторизован на этом устройстве — войдите в терминале: claude → /login';
  }
  if (/ENOENT|spawn/i.test(raw)) return 'Не удалось запустить Claude Code';
  if (/abort/i.test(raw)) return 'Агент не ответил за минуту';
  return raw;
};

/** One tiny round-trip through the Agent SDK to prove the connection works. */
export const verifyClaude = async (): Promise<{ok: boolean; model?: string; text?: string; error?: string}> => {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 60_000);
  try {
    const {query} = await import('@anthropic-ai/claude-agent-sdk');
    let text = '';
    let model = '';
    for await (const msg of query({
      prompt: 'Ответь одним словом: «готов».',
      options: {maxTurns: 1, allowedTools: [], abortController: abort, env: agentEnv()},
    })) {
      if (msg.type === 'system' && msg.subtype === 'init') model = msg.model;
      if (msg.type === 'assistant') {
        for (const block of msg.message.content) if (block.type === 'text') text += block.text;
      }
      if (msg.type === 'result' && msg.subtype !== 'success') {
        return {ok: false, error: humanError(msg.subtype)};
      }
    }
    verified = {at: new Date().toISOString(), model};
    const {updateSettings} = await import('./settings');
    await updateSettings({claudeVerifiedAt: verified.at}).catch(() => undefined);
    return {ok: true, model, text: text.trim()};
  } catch (err) {
    return {ok: false, error: humanError(err instanceof Error ? err.message : String(err))};
  } finally {
    clearTimeout(timer);
  }
};

export type Connector = {
  /** stable id for the studio: magnific, higgsfield, figma or the raw server name */
  id: string;
  name: string;
  /** connected | needs-auth | failed | pending | disabled | missing — as the SDK reports it */
  status: string;
  tools: number;
  /** claudeai = a claude.ai connector, plugin, user… */
  source?: string;
};
export type ConnectorsStatus = {at: string; model: string; plan?: string; connectors: Connector[]; error?: string; partial?: boolean};

const KNOWN: [RegExp, string, string][] = [
  [/magnific|freepik|pikaso/i, 'magnific', 'Magnific'],
  [/higgsfield/i, 'higgsfield', 'Higgsfield'],
  [/figma/i, 'figma', 'Figma'],
];
const CONNECTORS_TTL = 5 * 60_000;
let connectorsCache: ConnectorsStatus | null = null;
let connectorsPending: Promise<ConnectorsStatus> | null = null;

const rank = (c: Connector) => (c.status === 'connected' ? 0 : c.source === 'claudeai' ? 1 : 2);

/**
 * Which MCP connectors (claude.ai Magnific, Higgsfield, Figma…) an agent session sees.
 * The session is opened in streaming mode and never gets a user message, so no model call is made;
 * claude.ai connectors attach a few seconds after start, so the status is polled until they settle.
 */
export const connectorsStatus = async (fresh = false): Promise<ConnectorsStatus> => {
  if (!fresh && connectorsCache && Date.now() - Date.parse(connectorsCache.at) < (connectorsCache.partial ? 30_000 : CONNECTORS_TTL)) {
    return connectorsCache;
  }
  if (connectorsPending) return connectorsPending;
  connectorsPending = (async () => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 45_000);
    const result: ConnectorsStatus = {at: new Date().toISOString(), model: '', connectors: []};
    // an input stream that stays silent until the probe is done
    const silent = async function* () {
      await new Promise((resolve) => abort.signal.addEventListener('abort', resolve, {once: true}));
    } as unknown as () => AsyncIterable<never>;
    try {
      const {query} = await import('@anthropic-ai/claude-agent-sdk');
      const q = query({
        prompt: silent(),
        options: {cwd: ROOT, env: agentEnv(), abortController: abort, settingSources: ['user']},
      });
      const init = await q.initializationResult();
      result.model = init.models?.find((m) => (m as {isDefault?: boolean}).isDefault)?.value ?? '';
      result.plan = init.account?.subscriptionType;
      let list = await q.mcpServerStatus();
      // claude.ai connectors join a few seconds after start: wait while any is pending, or while none has appeared yet
      const settled = () => !list.some((srv) => srv.status === 'pending') && list.some((srv) => (srv.source ?? srv.scope) === 'claudeai');
      for (let i = 0; i < 25 && !settled(); i++) {
        await new Promise((r) => setTimeout(r, 1000));
        list = await q.mcpServerStatus();
      }
      const all = list.map((srv): Connector => {
        const known = KNOWN.find(([re]) => re.test(srv.name) || re.test(srv.serverInfo?.name ?? ''));
        return {
          id: known?.[1] ?? srv.name,
          name: known?.[2] ?? srv.name.replace(/^claude\.ai\s+/i, ''),
          status: srv.status,
          tools: srv.tools?.length ?? 0,
          source: srv.source ?? srv.scope,
        };
      });
      // one row per id: a connected claude.ai connector wins over a plugin copy that needs auth
      const byId = new Map<string, Connector>();
      for (const c of all) {
        const prev = byId.get(c.id);
        if (!prev || rank(c) < rank(prev)) byId.set(c.id, c);
      }
      result.connectors = [...byId.values()];
    } catch (err) {
      if (!abort.signal.aborted) result.error = humanError(err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
      abort.abort();
    }
    // an answer without any claude.ai connector is probably too early: keep it only briefly
    if (!result.error) connectorsCache = {...result, partial: !result.connectors.some((c) => c.source === 'claudeai')};
    return result;
  })();
  try {
    return await connectorsPending;
  } finally {
    connectorsPending = null;
  }
};
