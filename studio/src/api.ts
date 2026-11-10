import type {Project} from '../../runtime/manifest';

export type ProjectSummary = {
  id: string;
  title: string;
  scenes: number;
  seconds: number;
  updatedAt: string;
  cover: string | null;
};

export type AgentProvider = 'claude' | 'codex';
export type CodexStatus = ClaudeStatus & {error?: string; loginPending?: boolean};
export type ClaudeStatus = {
  login: boolean;
  apiKey: boolean;
  cli: boolean;
  verified: {at: string; model: string} | null;
};

export type Connector = {id: string; name: string; status: string; tools: number};
export type ConnectorsStatus = {at: string; model: string; plan?: string; connectors: Connector[]; error?: string};

/** a stopped (or failed) run that «Запустить снова» restarts */
export type Resumable = {jobId: string; title: string; status: string};
/** studio settings without secrets */
export type StudioSettings = {agentProvider: AgentProvider; codexVerifiedAt: string | null; figmaToken: boolean; fastPath: boolean; agentModel: string};

export type RenderJob = {
  id: string;
  projectId: string;
  status: 'bundling' | 'rendering' | 'done' | 'error';
  progress: number;
  url?: string;
  error?: string;
  /** the variant rendered on its own («Оживление скриншота») */
  sceneId?: string;
};


export type LogLine = {t: number; kind: 'status' | 'text' | 'tool' | 'todo' | 'error'; text: string};
export type Tokens = {input: number; output: number; cacheRead: number; cacheWrite: number};
/** points of the subscription windows a run used (5 hours, week) */
export type PlanUse = {plan: string | null; fiveHour?: number; week?: number};
export type RunMeta = {model?: string; costUsd?: number; durationMs?: number; turns?: number; tokens?: Tokens; planUse?: PlanUse};
/** the agent's spending on one project, over all its runs */
export type ProjectUsage = {runs: number; costUsd: number; durationMs: number; turns: number; tokens: Tokens; tokenRuns: number};
/** one item of the agent's checklist (TodoWrite) */
export type TodoItem = {content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm?: string};
export type Job = RunMeta & {
  connection?: import('../../runtime/connection-status').ConnectionStatus;
  id: string;
  projectId: string;
  sceneId: string | null;
  kind: 'create' | 'recalc' | 'chat';
  title: string;
  status: 'running' | 'done' | 'error' | 'stopped' | 'blocked';
  blocker?: {code:string;message:string};
  stage?: 'preparing-inputs'|'building-poses'|'animating'|'checking'|'waiting-approval'|'waiting-inputs'|'editing';
  startedAt: string;
  finishedAt?: string;
  summary?: string;
  error?: string;
  commitBefore?: string;
  rolledBack?: boolean;
  approvals?: Approval[];
  log: LogLine[];
  logTotal: number;
};
/** a paid Magnific call the agent asked for; pending ones wait for the chat card */
export type Approval = {
  id: string;
  tool: string;
  what: string;
  model?: string;
  estimate?: string;
  params?: string;
  status: 'pending' | 'allowed' | 'denied';
  at: string;
};
export type Attachment = {name: string; path: string; url: string; type: string; size: number};
/** a file of the asset bin (inputs/assets/) with its role and origin */
export type Asset = {
  file: string;
  role: string;
  tags: string[];
  source: string;
  prompt?: string;
  model?: string;
  cost?: number;
  addedAt?: string;
  url: string;
  path: string;
  type: string;
  size: number;
  missing?: boolean;
};
/** detail — what the version holds, in plain words; files — what it changed */
export type Version = {hash: string; at: string; message: string; detail?: string; files?: string; current: boolean};

export type ChatMessage = {
  id: string;
  sceneId: string | null;
  role: 'user' | 'agent';
  text: string;
  attachments?: Attachment[];
  jobId?: string;
  meta?: RunMeta;
  /** the contact sheet of a pose run */
  poses?: Pose[];
  posesState?: 'approved' | 'revised';
  at: string;
};
export type Pose = {file: string; url: string; scene?: string; group?: string; title?: string; frame?: number};

export class ApiError extends Error {
  constructor(message: string, public status: number) {super(message);}
}
const json = async <T,>(res: Response): Promise<T> => {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError((body as {error?: string}).error ?? res.statusText, res.status);
  }
  return res.json() as Promise<T>;
};

export const api = {
  codexConnectors: (fresh = false) => fetch(`/api/codex/connectors${fresh ? '?fresh=1' : ''}`).then((r) => json<ConnectorsStatus>(r)),
  loginCodexConnector: (id: 'figma'|'magnific') => fetch(`/api/codex/connectors/${id}/login`,{method:'POST'}).then((r)=>json<{authUrl:string}>(r)),
  checkFigma: (url:string) => fetch('/api/figma/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})}).then(r=>json<{ok:boolean;code:string;message:string;nodeId?:string}>(r)),
  codexStatus: () => fetch('/api/codex/status').then((r) => json<CodexStatus>(r)),
  codexLogin: () => fetch('/api/codex/login', {method: 'POST'}).then((r) => json<{authUrl: string}>(r)),
  cancelCodexLogin: () => fetch('/api/codex/login/cancel', {method: 'POST'}).then((r) => json<{ok: boolean}>(r)),
  verifyAgent: (provider: AgentProvider) => fetch('/api/agent/verify', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({provider})}).then((r) => json<{ok: boolean; model?: string; error?: string}>(r)),
  claudeStatus: () => fetch('/api/claude/status').then((r) => json<ClaudeStatus>(r)),
  verifyClaude: () =>
    fetch('/api/claude/verify', {method: 'POST'}).then((r) =>
      json<{ok: boolean; model?: string; text?: string; error?: string}>(r),
    ),
  connectors: (fresh = false) => fetch(`/api/connectors${fresh ? '?fresh=1' : ''}`).then((r) => json<ConnectorsStatus>(r)),
  projects: () => fetch('/api/projects').then((r) => json<ProjectSummary[]>(r)),
  project: (id: string) => fetch(`/api/projects/${id}`).then((r) => json<Project>(r)),
  saveProject: (p: Project) =>
    fetch(`/api/projects/${p.id}`, {
      method: 'PUT',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(p),
    }).then((r) => json<Project>(r)),
  startRender: (id: string, sceneId?: string) =>
    fetch(`/api/projects/${id}/render`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(sceneId ? {sceneId} : {}),
    }).then((r) => json<RenderJob>(r)),
  usage: (id: string) => fetch(`/api/projects/${id}/usage`).then((r) => json<ProjectUsage>(r)),
  renderStatus: (id: string) => fetch(`/api/projects/${id}/render`).then((r) => json<RenderJob | null>(r)),
  settings: () => fetch('/api/settings').then((r) => json<StudioSettings>(r)),
  saveSettings: (patch: {figmaToken?: string; fastPath?: boolean; agentModel?: string}) =>
    fetch('/api/settings', {method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify(patch)}).then((r) =>
      json<StudioSettings>(r),
    ),
  setMockup: (id: string, material: string) =>
    fetch(`/api/projects/${id}/mockup`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({material})}).then((r) =>
      json<{material: string; file: string; size: [number, number]; screen: {x: number; y: number; w: number; h: number; r: number}}>(r),
    ),
  uploadBackground: (id: string, file: File) => {
    const form = new FormData();
    form.set('file', file);
    return fetch(`/api/projects/${id}/background-image`, {method: 'POST', body: form}).then((r) => json<{file: string}>(r));
  },
  resume: (id: string) => fetch(`/api/projects/${id}/resume`, {method: 'POST'}).then((r) => json<{jobId: string}>(r)),
  duplicateProject: (id: string) => fetch(`/api/projects/${id}/duplicate`, {method: 'POST'}).then((r) => json<{projectId: string}>(r)),
  deleteProject: (id: string) => fetch(`/api/projects/${id}`, {method: 'DELETE'}).then((r) => json<{ok: boolean; removedRenders: number; removedArchives: number}>(r)),
  createProject: (form: FormData) => fetch('/api/projects', {method: 'POST', body: form}).then((r) => json<{projectId: string; jobId: string}>(r)),
  recalc: (id: string, sceneId: string | null) =>
    fetch(`/api/projects/${id}/recalc`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({sceneId}),
    }).then((r) => json<{jobId: string}>(r)),
  chat: (id: string, body: {sceneId: string | null; message: string; playhead: number; selected?: string; attachments?: Attachment[]}) =>
    fetch(`/api/projects/${id}/chat`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}).then((r) =>
      json<{jobId: string}>(r),
    ),
  chatHistory: (id: string) =>
    fetch(`/api/projects/${id}/chat`, {signal: AbortSignal.timeout(10000)}).then((r) =>
      json<{messages: ChatMessage[]; running: {id: string; title: string; kind: string} | null; resumable: Resumable | null}>(r),
    ),
  uploadAttachments: (id: string, files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    return fetch(`/api/projects/${id}/attachments`, {method: 'POST', body: form}).then((r) => json<Attachment[]>(r));
  },
  assets: (id: string) => fetch(`/api/projects/${id}/assets`).then((r) => json<Asset[]>(r)),
  addAssets: (id: string, files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    return fetch(`/api/projects/${id}/assets`, {method: 'POST', body: form}).then((r) => json<Asset[]>(r));
  },
  updateAsset: (id: string, file: string, patch: {role?: string; tags?: string[]}) =>
    fetch(`/api/projects/${id}/assets/${encodeURIComponent(file)}`, {
      method: 'PATCH',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(patch),
    }).then((r) => json<Asset[]>(r)),
  removeAsset: (id: string, file: string) =>
    fetch(`/api/projects/${id}/assets/${encodeURIComponent(file)}`, {method: 'DELETE'}).then((r) => json<Asset[]>(r)),
  uploadMusic: (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return fetch(`/api/projects/${id}/music`, {method: 'POST', body: form}).then((r) => json<{file: string}>(r));
  },
  /** layer names the project's code wraps in <Layer> */
  codeLayers: (id: string) => fetch(`/api/projects/${id}/layers`).then((r) => json<string[]>(r)),
  versions: (id: string) => fetch(`/api/projects/${id}/versions`).then((r) => json<{dirty: boolean; versions: Version[]}>(r)),
  /** title + detail: a manual save of a change («правка: …»); without them — «сохранено вручную» */
  saveVersion: (id: string, note?: {title: string; detail: string}) =>
    fetch(`/api/projects/${id}/versions`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(note ?? {}),
    }).then((r) => json<{head: string}>(r)),
  switchVersion: (id: string, hash: string, label: string) =>
    fetch(`/api/projects/${id}/versions/${hash}`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({label}),
    }).then((r) => json<{head: string}>(r)),
  job: (id: string, since = 0) => fetch(`/api/jobs/${id}?since=${since}`, {signal: AbortSignal.timeout(10000)}).then((r) => json<Job>(r)),
  /** «Утвердить» starts the animation run, notes without approve re-render the poses */
  answerPoses: (id: string, body: {messageId: string; approve: boolean; notes: {title: string; text: string}[]; general?: string}) =>
    fetch(`/api/projects/${id}/poses`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}).then((r) =>
      json<{jobId: string}>(r),
    ),
  approve: (jobId: string, approvalId: string, allow: boolean) =>
    fetch(`/api/jobs/${jobId}/approve`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({approvalId, allow}),
    }).then((r) => json<Job>(r)),
  stopJob: (id: string) => fetch(`/api/jobs/${id}/stop`, {method: 'POST'}).then((r) => json<Job>(r)),
  rollbackJob: (id: string) => fetch(`/api/jobs/${id}/rollback`, {method: 'POST'}).then((r) => json<Job>(r)),
};
