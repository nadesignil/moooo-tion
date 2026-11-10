import {spawn, execFile} from 'node:child_process';
import {createInterface} from 'node:readline';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ROOT} from './paths';
import {readCodexPolicy} from './codex-policy';

/** Official Codex app-server, newline-delimited JSON-RPC over private stdio. */
export class CodexClient {
  private child: ReturnType<typeof spawn>;
  private seq = 0;
  private closed = false;
  private pending = new Map<number, {resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>}>();
  onEvent: (method: string, params: any) => void = () => {};
  onRequest: (method: string, params: any) => Promise<unknown> = async () => {throw new Error('Инструмент недоступен в студии');};
  onClose: (error: Error) => void = () => {};
  constructor(bin: string, overrides: Record<string, string | number | boolean> = {}) {
    this.child = spawn(/\.m?js$/i.test(bin) ? process.execPath : bin, [...(/\.m?js$/i.test(bin) ? [bin] : []), 'app-server', '--stdio', ...Object.entries(overrides).flatMap(([key, value]) => ['-c', `${key}=${JSON.stringify(value)}`])], {cwd: ROOT, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
    // Never forward raw CLI logs: they can contain account information.
    this.child.stderr!.resume();
    const fail = (e: Error) => {
      this.closed = true;
      for (const p of this.pending.values()) {clearTimeout(p.timer); p.reject(e);}
      this.pending.clear();
      this.onClose(e);
    };
    this.child.on('error', () => fail(new Error('Не удалось запустить Codex. Установите Codex CLI.')));
    const onExit = () => this.child.kill();
    process.once('exit', onExit);
    this.child.on('exit', () => {process.removeListener('exit', onExit); fail(new Error('Соединение с Codex закрыто'));});
    createInterface({input: this.child.stdout!}).on('line', (line) => {
      let m: any;
      try {m = JSON.parse(line);} catch {return;}
      if (m.method && m.id !== undefined) {
        void this.onRequest(m.method, m.params).then(
          (result) => this.send({id: m.id, result}),
          () => this.send({id: m.id, error: {code: -32603, message: 'Операция недоступна в студии'}}),
        );
      } else if (m.method) this.onEvent(m.method, m.params);
      else {
        const p = this.pending.get(m.id);
        if (!p) return;
        clearTimeout(p.timer); this.pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error.message ?? 'Ошибка Codex'));
        else p.resolve(m.result);
      }
    });
    this.child.stdin!.on('error', () => {});
  }
  private send(value: unknown) {if (!this.child.killed) this.child.stdin!.write(JSON.stringify(value) + '\n');}
  request(method: string, params: unknown = {}, timeout = 30_000): Promise<any> {
    if (this.closed) return Promise.reject(new Error('Соединение с Codex закрыто'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {this.pending.delete(id); reject(new Error(`Codex не ответил: ${method}`));}, timeout);
      this.pending.set(id, {resolve, reject, timer}); this.send({id, method, params});
    });
  }
  async init() {
    try {await this.request('initialize', {clientInfo: {name: 'moootion', title: 'Moootion Studio', version: '0.1.0'}, capabilities: {experimentalApi: true}});
    this.send({method: 'initialized', params: {}});
    return this;
    } catch (e) {this.close(); throw e;}
  }
  close() {
    this.closed = true;
    this.child.kill();
    for (const p of this.pending.values()) {clearTimeout(p.timer); p.reject(new Error('Соединение с Codex закрыто'));}
    this.pending.clear();
  }
}

/** PATH first, then the Codex desktop installation on Windows. No credentials are read. */
export const findCodex = async (): Promise<string | null> => {
  if (process.env.MOOOTION_CODEX_BIN) return process.env.MOOOTION_CODEX_BIN;
  const candidates = await new Promise<string[]>((resolve) => {
    execFile(process.platform === 'win32' ? 'where.exe' : 'which', ['codex'], {windowsHide: true}, (err, out) => {
      const bins = out.trim().split(/\r?\n/);
      resolve(err ? [] : bins);
    });
  });
  for (const candidate of candidates) {
    if (process.platform !== 'win32' || /\.exe$/i.test(candidate)) return candidate;
    const script = path.join(path.dirname(candidate), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (await fs.access(script).then(() => true, () => false)) return script;
  }
  if (process.platform === 'win32') {
    const base = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'OpenAI', 'Codex', 'bin');
    const dirs = await fs.readdir(base, {withFileTypes: true}).catch(() => []);
    for (const d of dirs.reverse()) {
      const exe = path.join(base, d.name, 'codex.exe');
      if (d.isDirectory() && await fs.access(exe).then(() => true, () => false)) return exe;
    }
  }
  return null;
};
export type CodexStatus = {cli: boolean; login: boolean; apiKey: boolean; verified: {at: string; model: string} | null; error?: string; loginPending?: boolean};
let authClient: Promise<CodexClient> | null = null;
let login: {id: string; url: string} | null = null;
let loginError: string | undefined;
let verified: CodexStatus['verified'] = null;
const auth = async () => {
  if (!authClient) authClient = (async () => {
    const bin = await findCodex();
    if (!bin) throw new Error('Codex CLI не установлен');
    const c = await new CodexClient(bin).init();
    c.onClose = () => {authClient = null; login = null;};
    c.onEvent = (method, p) => {
      if (method === 'account/login/completed') {login = null; loginError = p.success ? undefined : 'Вход не завершён. Попробуйте ещё раз.';}
    };
    return c;
  })().catch((e) => {authClient = null; throw e;});
  return authClient;
};
export const codexStatus = async (): Promise<CodexStatus> => {
  if (!await findCodex()) return {cli: false, login: false, apiKey: false, verified: null};
  try {
    const r = await (await auth()).request('account/read', {refreshToken: false});
    return {cli: true, login: Boolean(r.account), apiKey: r.account?.type === 'apiKey', verified, loginPending: Boolean(login), ...(loginError ? {error: loginError} : {})};
  } catch {return {cli: true, login: false, apiKey: false, verified: null, error: 'Не удалось проверить вход Codex. Обновите подключение.'};}
};
export const startCodexLogin = async () => {
  if (login) return {authUrl: login.url};
  loginError = undefined;
  const r = await (await auth()).request('account/login/start', {type: 'chatgpt'});
  const url = new URL(r.authUrl);
  if (url.protocol !== 'https:' || !['auth.openai.com', 'chatgpt.com', 'auth0.openai.com'].includes(url.hostname)) throw new Error('Codex вернул неизвестный адрес входа');
  login = {id: r.loginId, url: r.authUrl};
  return {authUrl: login.url};
};
export const cancelCodexLogin = async () => {
  if (login) await (await auth()).request('account/login/cancel', {loginId: login.id});
  login = null;
  return {ok: true};
};
/** Check auth + available model catalog, without a billable generation. */
export const verifyCodex = async () => {
  const st = await codexStatus();
  if (!st.login) return {ok: false, error: st.error ?? 'Сначала войдите в Codex через ChatGPT'};
  try {
    const {model} = await readCodexPolicy(await auth());
    verified = {at: new Date().toISOString(), model};
    return {ok: true, model};
  } catch {return {ok: false, error: 'Не удалось подтвердить доступ к Astra и её уровням рассуждения. Проверьте подключение и доступность модели; автоматическая замена отключена.'};}
};

/** Config names only, never tokens or header values. */
export const codexMcpNames = async (): Promise<string[]> => Object.keys((await (await auth()).request('config/read', {includeLayers: false})).config?.mcp_servers ?? {});
