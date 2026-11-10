import {CodexClient, findCodex, codexMcpNames} from './codex';
import type {Connector, ConnectorsStatus} from './claude';

export const CODEX_CONNECTORS = {
  figma: {name: 'Figma', server: 'moootion_figma', url: 'https://mcp.figma.com/mcp'},
  magnific: {name: 'Magnific', server: 'moootion_magnific', url: 'https://mcp.magnific.com'},
} as const;
export type ConnectorId = keyof typeof CODEX_CONNECTORS;
export const connectorId = (id: string): ConnectorId => {
  if (id !== 'figma' && id !== 'magnific') throw new Error('Неизвестное подключение');
  return id;
};
export type RemoteTool = {name: string; description?: string; inputSchema: Record<string, unknown>; remoteName?:string; server?:string};
const FIGMA_READ = new Set(['get_design_context', 'get_metadata', 'get_screenshot', 'get_variable_defs', 'get_code_connect_map', 'get_code_connect_suggestions', 'get_context_for_code_connect', 'get_figjam', 'get_motion_context', 'get_libraries', 'search_design_system', 'whoami', 'download_assets']);
export const connectorToolAllowed = (id: ConnectorId, tool: string) => id === 'magnific' ? (magnificRead(tool) || /^(images_|video_|audio_|models3d_|creations_(request_upload|finalize_upload|upload_image)$)/.test(tool)) : FIGMA_READ.has(tool);
export const magnificRead = (tool: string) => !/(generate|upscale|remove|delete|update|edit|train|process|convert|upload|purchase)/i.test(tool) && (['account_balance', 'simulate_cost', 'creations_get', 'creations_show', 'creations_wait'].includes(tool) || /_(list|show|get|status|search)$/.test(tool) || /^(list|get|search)_/.test(tool));

type Broker = {client: CodexClient; thread: string; tools: Record<ConnectorId, RemoteTool[]>; rows: Connector[]; logins: Partial<Record<ConnectorId,string>>; dirty: boolean};
let pending: Promise<Broker> | null = null;
let active: Broker | null = null;
let scan: Promise<Broker> | null = null;
const createBroker = async (): Promise<Broker> => {
  const bin = await findCodex();
  if (!bin) throw new Error('Codex CLI не установлен');
  const overrides: Record<string, string | number | boolean> = {'features.apps': true, 'features.plugins': true, 'features.shell_tool': false, 'features.code_mode_host': false};
  for (const name of await codexMcpNames()) overrides[`mcp_servers.${name}.enabled`] = false;
  for (const c of Object.values(CODEX_CONNECTORS)) {
    overrides[`mcp_servers.${c.server}.url`] = c.url;
    overrides[`mcp_servers.${c.server}.enabled`] = true;
    overrides[`mcp_servers.${c.server}.startup_timeout_sec`] = 20;
  }
  const client = await new CodexClient(bin, overrides).init();
  const b: Broker = {client, thread: '', tools: {figma: [], magnific: []}, rows: [], logins: {}, dirty: false};
  client.onRequest = async (method) => {
    if (method === 'mcpServer/elicitation/request') return {action: 'decline', content: null};
    throw new Error('Операция недоступна');
  };
  client.onEvent = (method, params) => {
    if (method === 'mcpServer/oauthLogin/completed') {b.dirty = true; b.logins = {};}
  };
  client.onClose = () => {if (active === b) {active = null; pending = null;}};
  try {
    const r = await client.request('thread/start', {cwd: process.cwd(), ephemeral: true, sandbox: 'read-only', approvalPolicy: 'untrusted'});
    b.thread = r.thread.id;
    return b;
  } catch (e) {client.close(); throw e;}
};
const broker = async (): Promise<Broker> => {
  if (active?.dirty) {const old = active; active = null; pending = null; old.client.close();}
  if (!pending) pending = createBroker().then((b) => active = b).catch((e) => {pending = null; throw e;});
  return pending;
};
const discover = async () => {
  if (scan) return scan;
  scan = (async () => {
    const b = await broker();
    const rows: Connector[] = [];
    // The account's installed apps are independent of separately configured OAuth MCP servers.
    // This broker never starts a model turn and exposes only the two filtered namespaces.
    let appTools: RemoteTool[] = [];
    try {
      const appStatus = await b.client.request('mcpServerStatus/list',{threadId:b.thread,serverName:'codex_apps',detail:'toolsAndAuthOnly',limit:10},45000);
      const appServer = appStatus.data?.find((s:any)=>s.name==='codex_apps');
      appTools = Object.values(appServer?.tools??{}) as RemoteTool[];
    } catch { /* Standalone CLI without apps: use configured official MCP endpoints below. */ }

    for (const id of ['figma','magnific'] as const) {
      const c = CODEX_CONNECTORS[id];
      const installed = appTools.filter(t=>t.name.startsWith(id+'.')).map(t=>({...t,remoteName:t.name,server:'codex_apps',name:t.name.slice(id.length+1)})).filter(t=>connectorToolAllowed(id,t.name));
      if(installed.length) {
        b.tools[id]=installed;
        rows.push({id,name:c.name,status:'connected',tools:installed.length,source:'codex-app'});
        continue;
      }
      try {
        const r = await b.client.request('mcpServerStatus/list', {threadId: b.thread, serverName: c.server, detail: 'toolsAndAuthOnly', limit: 10}, 45_000);
        const srv = r.data?.find((s: any) => s.name === c.server);
        const tools = Object.values(srv?.tools ?? {}) as RemoteTool[];
        b.tools[id] = tools.filter((t) => connectorToolAllowed(id,t.name));
        const status = b.tools[id].length ? 'connected' : srv?.authStatus === 'notLoggedIn' || /auth|401|login|authorization/i.test(srv?.toolsError ?? '') ? 'needs-auth' : 'failed';
        rows.push({id, name:c.name, status, tools:b.tools[id].length, source:'codex-mcp'});
      } catch {rows.push({id, name:c.name, status:'failed', tools:0, source:'codex-mcp'});}
    }
    b.rows = rows;
    return b;
  })().finally(() => {scan = null;});
  return scan;
};
let cache: ConnectorsStatus | null = null;
export const codexConnectorsStatus = async (fresh = false): Promise<ConnectorsStatus> => {
  if (!fresh && cache && Date.now() - Date.parse(cache.at) < 15_000 && !active?.dirty) return cache;
  try {
    const b = await discover();
    return cache = {at:new Date().toISOString(), model:'', connectors:b.rows};
  } catch {return {at:new Date().toISOString(), model:'', connectors:Object.entries(CODEX_CONNECTORS).map(([id,c])=>({id,name:c.name,status:'failed',tools:0})), error:'Не удалось подключить MCP. Проверьте Codex и доступ к интернету.'};}
};
export const loginCodexConnector = async (id: ConnectorId) => {
  const b = await broker();
  if (b.logins[id]) return {authUrl:b.logins[id]};
  const r = await b.client.request('mcpServer/oauth/login', {name:CODEX_CONNECTORS[id].server, threadId:b.thread, timeoutSecs:300}, 30_000);
  const u = new URL(r.authorizationUrl);
  if (u.protocol !== 'https:') throw new Error('Подключение вернуло небезопасный адрес входа');
  b.logins[id] = r.authorizationUrl;
  cache = null;
  return {authUrl:r.authorizationUrl};
};
export const codexConnectorTools = async (id: ConnectorId) => (await discover()).tools[id].map((t) => ({name:t.name, description:t.description ?? '', inputSchema:t.inputSchema}));
export const callCodexConnector = async (id: ConnectorId, tool: string, args: Record<string,unknown>) => {
  const b = await broker();
  if (!b.tools[id].some((t) => t.name === tool)) await discover();
  if (!connectorToolAllowed(id, tool) || !b.tools[id].some((t) => t.name === tool)) throw new Error('Инструмент недоступен. Подключите сервис в настройках студии.');
  const selected=b.tools[id].find(t=>t.name===tool)!;
  return b.client.request('mcpServer/tool/call', {threadId:b.thread, server:selected.server??CODEX_CONNECTORS[id].server, tool:selected.remoteName??tool, arguments:args}, 180_000);
};

/** Keep payment gating outside the model runtime and independent of MCP tool annotations. */
export const guardedConnectorCall = async <T>(id: ConnectorId, tool: string, args: Record<string,unknown>, invoke:()=>Promise<T>, approve?:()=>Promise<boolean>): Promise<T> => {
  if (!connectorToolAllowed(id,tool)) throw new Error('Студия разрешает только чтение Figma');
  if (id === 'magnific' && !magnificRead(tool) && !await approve?.()) throw new Error('Пользователь отклонил вызов Magnific. Не повторяй генерацию.');
  return invoke();
};

const canonical=(v:unknown):string=>v&&typeof v==='object'?(Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}'):JSON.stringify(v);
export const exactCostEstimate=(estimates:{input:string;text:string}[],tool:string,args:Record<string,unknown>)=>{
  for(const e of [...estimates].reverse()) {
    try {const p=JSON.parse(e.input);if(p.tool===tool && canonical(p.arguments)===canonical(args))return e;}catch{}
  }
  return undefined;
};
