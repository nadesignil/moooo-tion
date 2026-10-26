import fs from 'node:fs/promises';
import path from 'node:path';
import {agentEnv} from './claude';
import {ESCALATE, FAST_MODEL, fastContract, styleSection, studioContract, templateSection} from './agent-prompt';
import {readProject} from './projects';
import {assetsSection} from './assets';
import {snapshot, restore} from './git';
import {ROOT, projectDir} from './paths';
import {agentModel, readSettings} from './settings';

export type JobKind = 'create' | 'recalc' | 'chat';
/** `todo` carries the agent's checklist (TodoWrite) as JSON — the chat draws it live */
export type LogLine = {t: number; kind: 'status' | 'text' | 'tool' | 'todo' | 'error'; text: string};

/** tokens of a run, summed over the model's messages (cache reads are most of a long run) */
export type Tokens = {input: number; output: number; cacheRead: number; cacheWrite: number};
/** what a run cost: shown under the agent's reply. `tokens` is counted even when the run is stopped */
export type RunMeta = {model?: string; costUsd?: number; durationMs?: number; turns?: number; tokens?: Tokens};

const NO_TOKENS: Tokens = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0};
const addTokens = (a: Tokens, b: Tokens): Tokens => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
});

/** a paid Magnific call waiting for the user's «Разрешить / Отклонить» in the chat */
export type Approval = {
  id: string;
  tool: string;
  /** what will be made, in plain words (prompt, size…) */
  what: string;
  model?: string;
  /** the simulate_cost answer for these parameters, if the agent asked */
  estimate?: string;
  /** the call's input, shortened — what exactly will be sent */
  params?: string;
  status: 'pending' | 'allowed' | 'denied';
  at: string;
};

export type Job = RunMeta & {
  id: string;
  projectId: string;
  sceneId: string | null;
  kind: JobKind;
  title: string;
  status: 'running' | 'done' | 'error' | 'stopped';
  startedAt: string;
  finishedAt?: string;
  summary?: string;
  error?: string;
  commitBefore?: string;
  commitAfter?: string;
  rolledBack?: boolean;
  /** paid calls the agent asked for in this run, the last one may be pending */
  approvals?: Approval[];
  log: LogLine[];
};

export type Attachment = {name: string; path: string; url: string; type: string; size: number};

export type ChatMessage = {
  id: string;
  sceneId: string | null;
  role: 'user' | 'agent';
  text: string;
  attachments?: Attachment[];
  jobId?: string;
  meta?: RunMeta;
  /** a contact sheet of key poses waiting for «Утвердить» / «Поправить» */
  poses?: Pose[];
  /** what the user answered on the sheet */
  posesState?: 'approved' | 'revised';
  at: string;
};

/** one still of the pose run (.moootion/poses/poses.json) */
export type Pose = {file: string; url: string; scene?: string; group?: string; title?: string; frame?: number};

const jobs = new Map<string, Job>();
const aborts = new Map<string, AbortController>();

export const getJob = (id: string) => jobs.get(id) ?? null;
export const runningJob = (projectId: string) =>
  [...jobs.values()].find((j) => j.projectId === projectId && j.status === 'running') ?? null;

// ── chat history (per project, scene-tagged) ─────────────
const chatFile = (projectId: string) => path.join(projectDir(projectId), '.moootion', 'chat.json');

export const readChat = async (projectId: string): Promise<ChatMessage[]> => {
  try {
    return JSON.parse(await fs.readFile(chatFile(projectId), 'utf8')) as ChatMessage[];
  } catch {
    return [];
  }
};

const appendChat = async (projectId: string, msg: Omit<ChatMessage, 'id' | 'at'>) => {
  const all = await readChat(projectId);
  all.push({...msg, id: `m-${Date.now().toString(36)}-${all.length}`, at: new Date().toISOString()});
  await fs.mkdir(path.dirname(chatFile(projectId)), {recursive: true});
  await fs.writeFile(chatFile(projectId), JSON.stringify(all.slice(-500), null, 2), 'utf8');
};

/** mark a contact sheet as answered */
export const setPosesState = async (projectId: string, messageId: string, posesState: 'approved' | 'revised') => {
  const all = await readChat(projectId);
  const m = all.find((x) => x.id === messageId);
  if (!m?.poses) throw new Error('Контакт-лист не найден');
  if (m.posesState) throw new Error('На этот контакт-лист уже ответили');
  m.posesState = posesState;
  await fs.writeFile(chatFile(projectId), JSON.stringify(all, null, 2), 'utf8');
  return m;
};

/** the stills the pose run rendered, as the agent listed them (or simply the png files) */
export const readPoses = async (projectId: string): Promise<Pose[]> => {
  const dir = path.join(projectDir(projectId), '.moootion', 'poses');
  const stamp = Date.now().toString(36);
  const url = (file: string) => `/files/${projectId}/.moootion/poses/${encodeURIComponent(file)}?v=${stamp}`;
  const exists = async (file: string) =>
    fs
      .access(path.join(dir, file))
      .then(() => true)
      .catch(() => false);
  try {
    const list = JSON.parse(await fs.readFile(path.join(dir, 'poses.json'), 'utf8')) as Omit<Pose, 'url'>[];
    const out: Pose[] = [];
    for (const p of Array.isArray(list) ? list : []) {
      const file = path.basename(String(p.file ?? ''));
      if (file && (await exists(file))) out.push({...p, file, url: url(file)});
    }
    if (out.length) return out;
  } catch {
    // no list: fall back to the png files
  }
  const files = (await fs.readdir(dir).catch(() => [] as string[])).filter((f) => /\.png$/i.test(f)).sort();
  return files.map((file) => ({file, url: url(file), title: file.replace(/\.png$/i, '')}));
};

// ── tool call → one human line ────────────────────────────
const short = (s: unknown, n = 90) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
const rel = (projectId: string, p: unknown) => {
  const s = String(p ?? '');
  const base = projectDir(projectId);
  return s.startsWith(base) ? s.slice(base.length + 1).replace(/\\/g, '/') : s.replace(/\\/g, '/');
};
const describeTool = (projectId: string, name: string, input: Record<string, unknown>) => {
  switch (name) {
    case 'Read':
      return `Читает ${rel(projectId, input.file_path)}`;
    case 'Write':
      return `Пишет ${rel(projectId, input.file_path)}`;
    case 'Edit':
    case 'MultiEdit':
      return `Правит ${rel(projectId, input.file_path)}`;
    case 'Bash':
      return `$ ${short(input.command, 110)}`;
    case 'Glob':
      return `Ищет файлы ${short(input.pattern)}`;
    case 'Grep':
      return `Ищет «${short(input.pattern, 40)}»`;
    case 'TodoWrite':
      return 'Обновляет план';
    case 'WebFetch':
      return `Открывает ${short(input.url)}`;
    default:
      if (/magnific/i.test(name)) return `Magnific · ${name.split('__').pop()?.replace(/_/g, ' ')}`;
      if (/figma/i.test(name)) return `Figma · ${name.split('__').pop()} ${short(input.nodeId ?? '', 20)}`;
      return `${name} ${short(JSON.stringify(input), 80)}`;
  }
};

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead']);

/**
 * Does a tool call reach into another project's folder? Returns that project's id,
 * or '*' for wildcards over all projects. Its own project is fine; the reference lives in templates/, outside projects/.
 */
const foreignProject = (own: string, text: string, cwd: string) => {
  const norm = text.split('\\').join('/');
  for (const m of norm.matchAll(/projects\/+([^/\s"'`;|&<>()]+)/gi)) {
    const id = m[1];
    if (/[*?{[]/.test(id)) return '*';
    if (id !== own) return id;
  }
  // relative escapes from the project folder: ../other-project
  for (const m of norm.matchAll(/(?:^|[\s"'=])\.\.\/([^/\s"'`;|&<>()]+)/g)) {
    const target = path.resolve(cwd, '..', m[1]);
    if (path.dirname(target) === path.dirname(cwd)) {
      const id = path.basename(target);
      if (/[*?{[]/.test(id)) return '*';
      if (id !== own) return id;
    }
  }
  return null;
};
const FIGMA_READ = new Set([
  'get_metadata',
  'get_screenshot',
  'get_design_context',
  'download_assets',
  'get_variable_defs',
  'get_motion_context',
  'get_figjam',
  'whoami',
  'search_design_system',
  'get_libraries',
]);

// Magnific connector (claude.ai «Magnific»): reading is free, everything else spends credits
const isMagnific = (toolName: string) => /^mcp__.*magnific/i.test(toolName);
const MAGNIFIC_READ = new Set(['account_balance', 'simulate_cost', 'creations_get', 'creations_show', 'creations_wait']);
const magnificIsRead = (name: string) => MAGNIFIC_READ.has(name) || /_(list|show|get|status|search)$/.test(name) || /^(list|get|search)_/.test(name);

const MAGNIFIC_WHAT: Record<string, string> = {
  images_generate: 'Картинка',
  video_generate: 'Видео',
  images_remove_background: 'Убрать фон',
  images_upscale: 'Апскейл',
  models3d_generate: '3D-модель',
};
/** the approval card's first line: what will be made, from the call's input */
const describePaid = (name: string, input: Record<string, unknown>) => {
  const kind = MAGNIFIC_WHAT[name] ?? (/audio/.test(name) ? 'Звук' : name.replace(/_/g, ' '));
  const prompt = input.prompt ?? input.text ?? input.description;
  const size = [input.aspect_ratio, input.resolution, input.size, input.duration ? `${input.duration} с` : '', input.num_images || input.count ? `×${input.num_images ?? input.count}` : '']
    .filter(Boolean)
    .join(' · ');
  return [kind, prompt ? `«${short(prompt, 160)}»` : '', size].filter(Boolean).join(' — ');
};

/** the model of a paid call: a top-level or nested field named like model / engine */
const findModel = (input: unknown, depth = 0): string | undefined => {
  if (!input || typeof input !== 'object' || depth > 3) return undefined;
  for (const [k, v] of Object.entries(input)) {
    if (/model|engine|^mode$/i.test(k) && (typeof v === 'string' || typeof v === 'number')) return String(v);
  }
  for (const v of Object.values(input)) {
    const m = findModel(v, depth + 1);
    if (m) return m;
  }
  return undefined;
};

const primitives = (v: unknown, out: string[] = []): string[] => {
  if (v == null) return out;
  if (typeof v === 'object') for (const x of Object.values(v)) primitives(x, out);
  else out.push(String(v));
  return out;
};

/**
 * The estimate for this paid call: the simulate_cost asked with the most of its values
 * (model, prompt, size…); on a tie — the later one. Credits are read from a JSON answer.
 */
const pickEstimate = (estimates: {input: string; text: string}[], paid: Record<string, unknown>) => {
  const values = primitives(paid).filter((v) => v.length > 1);
  let best: {score: number; text: string} | null = null;
  for (const e of estimates) {
    const score = values.filter((v) => e.input.includes(JSON.stringify(v))).length;
    if (!best || score >= best.score) best = {score, text: e.text};
  }
  if (!best) return undefined;
  try {
    const j = JSON.parse(best.text) as {credits?: number; certainty?: string; isUnlimited?: boolean};
    if (typeof j.credits === 'number') {
      return `${j.credits} кр.${j.certainty && j.certainty !== 'exact' ? ' (примерно)' : ''}${j.isUnlimited ? ' · безлимит' : ''}`;
    }
  } catch {
    // not JSON: show the text as it came
  }
  return short(best.text, 220);
};

/** waiting approvals: job id → resolve(allowed) */
const waiting = new Map<string, {approvalId: string; resolve: (allowed: boolean) => void}>();

/** «Разрешить / Отклонить» from the chat card */
export const answerApproval = (jobId: string, approvalId: string, allow: boolean) => {
  const w = waiting.get(jobId);
  if (!w || w.approvalId !== approvalId) throw new Error('Этот запрос уже не ждёт ответа');
  w.resolve(allow);
  return getJob(jobId);
};

/** Run the agent on a project. Returns immediately; follow the job by id. */
export const startJob = async (o: {
  projectId: string;
  sceneId: string | null;
  kind: JobKind;
  title: string;
  prompt: string;
  userText?: string;
  userAttachments?: Attachment[];
  maxTurns?: number;
  /** try the fast model first (manifest-only edits), hand over to the main model if code is needed */
  fast?: boolean;
  /** a pose run: the reply carries the contact sheet from .moootion/poses/ */
  poses?: boolean;
  /** the task as first given (a restart adds a note to the prompt, the next restart starts from this again) */
  basePrompt?: string;
  onDone?: (job: Job) => Promise<void>;
}): Promise<Job> => {
  let busy = runningJob(o.projectId);
  // a stopped run takes a moment to wind down: wait for it instead of refusing the restart
  for (let i = 0; busy && aborts.get(busy.id)?.signal.aborted && i < 50; i++) {
    await new Promise((r) => setTimeout(r, 200));
    busy = runningJob(o.projectId);
  }
  if (busy) throw new Error('Агент уже работает над этим проектом — дождитесь окончания или остановите его');

  const job: Job = {
    id: `job-${Date.now().toString(36)}`,
    projectId: o.projectId,
    sceneId: o.sceneId,
    kind: o.kind,
    title: o.title,
    status: 'running',
    startedAt: new Date().toISOString(),
    log: [],
  };
  // what it takes to run this task again after a stop (see resumeJob)
  const lastRun: LastRun = {
    jobId: job.id,
    kind: o.kind,
    title: o.basePrompt ? o.title.replace(/^Снова: /, '') : o.title,
    sceneId: o.sceneId,
    prompt: o.basePrompt ?? o.prompt,
    ...(o.poses ? {poses: true} : {}),
    ...(o.fast ? {fast: true} : {}),
    ...(o.maxTurns ? {maxTurns: o.maxTurns} : {}),
  };
  await fs.mkdir(path.join(projectDir(o.projectId), '.moootion'), {recursive: true}).catch(() => undefined);
  await fs.writeFile(lastRunFile(o.projectId), JSON.stringify(lastRun, null, 2)).catch(() => undefined);
  jobs.set(job.id, job);
  const push = (kind: LogLine['kind'], text: string) => job.log.push({t: Date.now(), kind, text});
  const abort = new AbortController();
  aborts.set(job.id, abort);

  if (o.userText) {
    await appendChat(o.projectId, {
      sceneId: o.sceneId,
      role: 'user',
      text: o.userText,
      jobId: job.id,
      ...(o.userAttachments?.length ? {attachments: o.userAttachments} : {}),
    });
  }
  await persistJob(job);

  (async () => {
    const dir = projectDir(o.projectId);
    try {
      job.commitBefore = await snapshot(o.projectId, `до: ${o.title}`).catch(() => undefined);
      push('status', 'Запускаю агента…');
      const {query} = await import('@anthropic-ai/claude-agent-sdk');
      const settings = await readSettings();
      const env = {...agentEnv(), ...(settings.figmaToken ? {FIGMA_TOKEN: settings.figmaToken} : {})};
      // the project's style and ban list (Настройки проекта) travel with every run
      // …and so does the asset bin with each file's role
      const manifest = await readProject(o.projectId).catch(() => null);
      const style = styleSection(manifest?.settings) + templateSection(manifest) + (await assetsSection(o.projectId));
      // the agent's Magnific simulate_cost answers: the one asked with the paid call's parameters goes onto its card
      const estimateCalls = new Map<string, string>();
      const estimates: {input: string; text: string}[] = [];
      // the SDK repeats a message's usage on every content block: keep the largest per message id
      const usage = new Map<string, Tokens>();

      /** one agent run; `fast` = the fast model that may write project.json only */
      const run = async (fast: boolean) => {
        let summary: string | undefined;
        let error: string | undefined;
        for await (const msg of query({
          prompt: o.prompt,
          options: {
            cwd: dir,
            additionalDirectories: [ROOT],
            env,
            abortController: abort,
            maxTurns: fast ? 30 : (o.maxTurns ?? 150),
            settingSources: ['user'],
            model: fast ? FAST_MODEL : agentModel(settings),
            systemPrompt: {type: 'preset', preset: 'claude_code', append: fast ? fastContract(o.projectId) : studioContract(o.projectId) + style},
            // only harmless tools are pre-approved; reads and shell go through the isolation check below
            allowedTools: ['TodoWrite', 'WebFetch'],
            canUseTool: async (toolName, input) => {
              // a project never reads another project (the reference in templates/ is readable)
              if (READ_TOOLS.has(toolName) || toolName === 'Bash') {
                if (fast && toolName === 'Bash') return {behavior: 'deny', message: `Быстрая правка — только project.json. Если нужно больше, ответь ${ESCALATE}.`};
                const text = [input.file_path, input.path, input.pattern, input.command].filter(Boolean).join(' ');
                const foreign = foreignProject(o.projectId, text, dir);
                if (foreign) {
                  return {
                    behavior: 'deny',
                    message: `Другие проекты студии (${foreign}) этому проекту недоступны: бери материалы только из своей раскадровки, inputs/ и вложений пользователя.`,
                  };
                }
                return {behavior: 'allow', updatedInput: input};
              }
              if (WRITE_TOOLS.has(toolName)) {
                const target = path.resolve(dir, String(input.file_path ?? input.notebook_path ?? ''));
                if (fast) {
                  if (target === path.join(dir, 'project.json')) return {behavior: 'allow', updatedInput: input};
                  return {behavior: 'deny', message: `Быстрая правка меняет только project.json. Нужен код — ответь ${ESCALATE}: <почему>.`};
                }
                if (target.startsWith(dir + path.sep)) return {behavior: 'allow', updatedInput: input};
                return {behavior: 'deny', message: `Писать можно только внутри папки проекта: ${dir}`};
              }
              // Figma connector: read-only tools only, never write into the user's Figma files
              if (!fast && /^mcp__.*figma/i.test(toolName)) {
                const name = toolName.split('__').pop() ?? '';
                if (FIGMA_READ.has(name)) return {behavior: 'allow', updatedInput: input};
                return {behavior: 'deny', message: 'Студия разрешает только чтение из Figma'};
              }
              // Magnific: balance, prices, lists — free; a paid call waits for the user's answer in the chat
              if (!fast && isMagnific(toolName)) {
                const name = toolName.split('__').pop() ?? '';
                if (magnificIsRead(name)) return {behavior: 'allow', updatedInput: input};
                const approval: Approval = {
                  id: `ap-${Date.now().toString(36)}`,
                  tool: name,
                  what: describePaid(name, input),
                  model: findModel(input),
                  estimate: pickEstimate(estimates, input),
                  params: short(JSON.stringify(input), 300),
                  status: 'pending',
                  at: new Date().toISOString(),
                };
                job.approvals = [...(job.approvals ?? []), approval];
                push('status', `Ждёт вашего разрешения: Magnific · ${approval.what}`);
                const allowed = await new Promise<boolean>((resolve) => {
                  const done = (v: boolean) => {
                    clearTimeout(timer);
                    abort.signal.removeEventListener('abort', onAbort);
                    waiting.delete(job.id);
                    resolve(v);
                  };
                  const onAbort = () => done(false);
                  // nobody answered in 15 minutes: treat as «Отклонить», the run goes on
                  const timer = setTimeout(() => done(false), 15 * 60 * 1000);
                  abort.signal.addEventListener('abort', onAbort);
                  waiting.set(job.id, {approvalId: approval.id, resolve: done});
                });
                approval.status = allowed ? 'allowed' : 'denied';
                push('status', allowed ? `Разрешено: ${approval.what}` : `Отклонено: ${approval.what}`);
                await persistJob(job);
                if (allowed) return {behavior: 'allow', updatedInput: input};
                return {
                  behavior: 'deny',
                  message:
                    'Пользователь отклонил этот платный вызов Magnific. Не повторяй его с теми же параметрами: обойдись без него или в итоге предложи, что сгенерировать, и спроси.',
                };
              }
              return {behavior: 'deny', message: `Инструмент ${toolName} студией не разрешён`};
            },
          },
        })) {
          if (msg.type === 'system' && msg.subtype === 'init') {
            job.model = msg.model;
            push('status', fast ? `Быстрая правка · ${msg.model}` : `Агент на связи · ${msg.model}`);
          }
          if (msg.type === 'assistant') {
            const u = msg.message.usage;
            if (u && msg.message.id) {
              const was = usage.get(msg.message.id) ?? NO_TOKENS;
              usage.set(msg.message.id, {
                input: Math.max(was.input, u.input_tokens ?? 0),
                output: Math.max(was.output, u.output_tokens ?? 0),
                cacheRead: Math.max(was.cacheRead, u.cache_read_input_tokens ?? 0),
                cacheWrite: Math.max(was.cacheWrite, u.cache_creation_input_tokens ?? 0),
              });
              job.tokens = [...usage.values()].reduce(addTokens, NO_TOKENS);
            }
            for (const block of msg.message.content) {
              if (block.type === 'text' && block.text.trim()) push('text', block.text.trim());
              if (block.type === 'tool_use') {
                const input = block.input as Record<string, unknown>;
                // the plan is a checklist in the chat, not a log line
                if (block.name === 'TodoWrite') push('todo', JSON.stringify(input.todos ?? []));
                else push('tool', describeTool(o.projectId, block.name, input));
                if (isMagnific(block.name) && block.name.endsWith('simulate_cost')) estimateCalls.set(block.id, JSON.stringify(input));
              }
            }
          }
          if (msg.type === 'user' && Array.isArray(msg.message.content)) {
            for (const block of msg.message.content) {
              if (block.type !== 'tool_result' || !estimateCalls.has(block.tool_use_id)) continue;
              const c = block.content;
              const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => ('text' in x ? x.text : '')).join(' ') : '';
              if (text.trim()) estimates.push({input: estimateCalls.get(block.tool_use_id) ?? '', text});
            }
          }
          if (msg.type === 'result') {
            // a fast attempt that escalated still counts in what the run cost
            job.costUsd = (job.costUsd ?? 0) + (msg.total_cost_usd ?? 0);
            job.durationMs = (job.durationMs ?? 0) + (msg.duration_ms ?? 0);
            job.turns = (job.turns ?? 0) + (msg.num_turns ?? 0);
            if (msg.subtype === 'success') summary = msg.result;
            else error = msg.subtype === 'error_max_turns' ? 'Агент упёрся в лимит шагов' : 'Агент завершился с ошибкой';
          }
        }
        return {summary, error};
      };

      // chat and recalc try the fast model first; it hands over when the task needs code
      let res = o.fast && settings.fastPath !== false ? await run(true) : null;
      // the SDK may end a stopped run quietly — a stop is never «done» (the backlog must stay for the next try)
      if (abort.signal.aborted) throw new Error('stopped');
      const escalate = res && (res.error || !res.summary || res.summary.trim().startsWith(ESCALATE));
      if (res && escalate) {
        const why = res.summary?.replace(ESCALATE, '').replace(/^[:\s]+/, '').trim();
        push('status', `Нужна правка кода — передаю основной модели${why ? `: ${why}` : ''}`);
        // whatever the fast attempt wrote stays: the main model continues from the manifest as it is now
        res = null;
      }
      if (!res) res = await run(false);
      if (abort.signal.aborted) throw new Error('stopped');
      job.summary = res.summary;
      job.error = res.error;
      job.status = job.error ? 'error' : 'done';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (abort.signal.aborted) {
        job.status = 'stopped';
        push('status', 'Остановлено');
      } else {
        job.status = 'error';
        job.error = message;
        push('error', message);
      }
    } finally {
      aborts.delete(job.id);
      job.finishedAt = new Date().toISOString();
      try {
        if (o.onDone && job.status === 'done') await o.onDone(job);
        job.commitAfter = await snapshot(o.projectId, `агент: ${o.title}`);
      } catch (err) {
        push('error', `Не удалось сохранить версию: ${err instanceof Error ? err.message : String(err)}`);
      }
      const text =
        job.status === 'done'
          ? job.summary || 'Готово.'
          : job.status === 'stopped'
            ? 'Остановлено пользователем.'
            : `Ошибка: ${job.error ?? 'неизвестно'}`;
      const durationMs = job.durationMs ?? Date.now() - new Date(job.startedAt).getTime();
      const meta: RunMeta = {model: job.model, costUsd: job.costUsd, durationMs, turns: job.turns, tokens: job.tokens};
      // a pose run ends with its contact sheet
      const poses = o.poses && job.status === 'done' ? await readPoses(o.projectId).catch(() => [] as Pose[]) : [];
      await appendChat(o.projectId, {
        sceneId: o.sceneId,
        role: 'agent',
        text,
        jobId: job.id,
        meta,
        ...(poses.length ? {poses} : {}),
      }).catch(() => undefined);
      await persistJob(job);
    }
  })();

  return job;
};

/** What the agent spent on a project, over every run in .moootion/jobs (stopped ones too). */
export const projectUsage = async (projectId: string) => {
  const dir = path.join(projectDir(projectId), '.moootion', 'jobs');
  const files = (await fs.readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.json'));
  const total = {runs: 0, costUsd: 0, durationMs: 0, turns: 0, tokens: NO_TOKENS, tokenRuns: 0};
  for (const f of files) {
    const j = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8').catch(() => 'null')) as Job | null;
    if (!j) continue;
    total.runs++;
    total.costUsd += j.costUsd ?? 0;
    // a stopped run has no result message: its wall time stands in
    const wall = j.finishedAt ? new Date(j.finishedAt).getTime() - new Date(j.startedAt).getTime() : 0;
    total.durationMs += j.durationMs ?? wall;
    total.turns += j.turns ?? 0;
    if (j.tokens) {
      total.tokens = addTokens(total.tokens, j.tokens);
      total.tokenRuns++;
    }
  }
  return total;
};

const persistJob = async (job: Job) => {
  const dir = path.join(projectDir(job.projectId), '.moootion', 'jobs');
  await fs.mkdir(dir, {recursive: true}).catch(() => undefined);
  await fs.writeFile(path.join(dir, `${job.id}.json`), JSON.stringify(job, null, 2)).catch(() => undefined);
};

/** After a server restart: jobs that were running are gone — say so in the chat. */
export const recoverInterruptedJobs = async () => {
  const {PROJECTS} = await import('./paths');
  const projects = await fs.readdir(PROJECTS).catch(() => [] as string[]);
  for (const id of projects) {
    const dir = path.join(PROJECTS, id, '.moootion', 'jobs');
    const files = await fs.readdir(dir).catch(() => [] as string[]);
    for (const f of files) {
      const file = path.join(dir, f);
      try {
        const job = JSON.parse(await fs.readFile(file, 'utf8')) as Job;
        if (job.status !== 'running') continue;
        job.status = 'error';
        job.error = 'Прервано перезапуском сервера студии';
        job.finishedAt = new Date().toISOString();
        await fs.writeFile(file, JSON.stringify(job, null, 2));
        jobs.set(job.id, job);
        await appendChat(job.projectId, {
          sceneId: job.sceneId,
          role: 'agent',
          text: 'Работа прервалась: сервер студии перезапустился. Отправьте задачу ещё раз — изменения, которые я успел сделать, сохранены в проекте.',
          jobId: job.id,
        });
      } catch {
        // unreadable job file
      }
    }
  }
};

// ── restart a stopped run ──────────────────────────────
type LastRun = {jobId: string; kind: JobKind; title: string; sceneId: string | null; prompt: string; poses?: boolean; fast?: boolean; maxTurns?: number};
const lastRunFile = (projectId: string) => path.join(projectDir(projectId), '.moootion', 'last-run.json');

const readJobRecord = async (projectId: string, id: string): Promise<Job | null> =>
  jobs.get(id) ??
  (await fs
    .readFile(path.join(projectDir(projectId), '.moootion', 'jobs', `${id}.json`), 'utf8')
    .then((t) => JSON.parse(t) as Job)
    .catch(() => null));

/** the last run of the project, if it was stopped or failed; projects from before last-run.json: a stopped creation */
const lastStopped = async (projectId: string): Promise<{run: LastRun; job: Job} | null> => {
  const saved = await fs
    .readFile(lastRunFile(projectId), 'utf8')
    .then((t) => JSON.parse(t) as LastRun)
    .catch(() => null);
  if (saved) {
    const job = await readJobRecord(projectId, saved.jobId);
    return job && (job.status === 'stopped' || job.status === 'error') ? {run: saved, job} : null;
  }
  const dir = path.join(projectDir(projectId), '.moootion', 'jobs');
  const files = (await fs.readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.json'));
  const all = (await Promise.all(files.map((f) => readJobRecord(projectId, f.replace(/\.json$/, ''))))).filter((j): j is Job => Boolean(j));
  const last = all.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (!last || last.kind !== 'create' || (last.status !== 'stopped' && last.status !== 'error')) return null;
  const brief = await fs.readFile(path.join(projectDir(projectId), '.moootion', 'brief.md'), 'utf8').catch(() => '');
  if (!brief) return null;
  return {run: {jobId: last.id, kind: 'create', title: last.title, sceneId: last.sceneId, prompt: brief, poses: brief.includes('ПЕРВЫЙ из двух прогонов'), maxTurns: 400}, job: last};
};

export const resumable = async (projectId: string) => {
  if (runningJob(projectId)) return null;
  const r = await lastStopped(projectId);
  return r ? {jobId: r.job.id, title: r.run.title, status: r.job.status} : null;
};

const CONTINUE_NOTE = `

---
Этот прогон уже запускался и был остановлен (или упал) на середине. Сначала посмотри, что уже сделано в проекте
(project.json, src/, .moootion/), и продолжи с этого места — готовое не переделывай.`;

/** runs the stopped task again with the same prompt and a note to continue */
export const resumeJob = async (projectId: string, onDone?: (job: Job) => Promise<void>) => {
  const r = await lastStopped(projectId);
  if (!r) throw new Error('Нечего перезапускать — последняя задача не была остановлена');
  return startJob({
    projectId,
    sceneId: r.run.sceneId,
    kind: r.run.kind,
    title: `Снова: ${r.run.title}`,
    prompt: r.run.prompt + CONTINUE_NOTE,
    basePrompt: r.run.prompt,
    userText: `Запустить снова: «${r.run.title}».`,
    poses: r.run.poses,
    fast: r.run.fast,
    maxTurns: r.run.maxTurns,
    onDone,
  });
};

export const stopJob = (id: string) => {
  aborts.get(id)?.abort();
  return getJob(id);
};

export const rollbackJob = async (id: string) => {
  const job = jobs.get(id);
  if (!job?.commitBefore) throw new Error('Для этой задачи нет сохранённой версии');
  await restore(job.projectId, job.commitBefore, `откат: ${job.title}`);
  job.rolledBack = true;
  await appendChat(job.projectId, {sceneId: job.sceneId, role: 'agent', text: `Откатил правку «${job.title}».`, jobId: job.id});
  return job;
};
