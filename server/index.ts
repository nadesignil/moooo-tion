import {createReadStream} from 'node:fs';
import fs from 'node:fs/promises';
import {Readable} from 'node:stream';
import path from 'node:path';
import os from 'node:os';
import {serve} from '@hono/node-server';
import {Hono} from 'hono';
import {LIBRARY, RENDERS, ROOT, projectDir} from './paths';
import {duplicateProject, listProjects, readProject, trashProject, writeProject} from './projects';
import {scaffoldProject, scaffoldScreenProject, uniqueId} from './scaffold';
import {BackgroundSchema, ScreenTemplateSchema, type ProjectSettings, type ScreenTemplate} from '../runtime/manifest';
import {publicSettings, updateSettings} from './settings';

console.log('moootion api: starting…');
const app = new Hono();

// heavy modules (Agent SDK, Remotion renderer) load on first use
const claude = () => import('./claude');
const render = () => import('./render');
const jobsMod = () => import('./jobs');
const promptMod = () => import('./agent-prompt');

app.onError((err, c) => {
  console.error(err);
  return c.json({error: err.message}, 500);
});

// ── Claude ─────────────────────────────────────────────
app.get('/api/claude/status', async (c) => c.json(await (await claude()).claudeStatus()));
app.post('/api/claude/verify', async (c) => c.json(await (await claude()).verifyClaude()));
app.get('/api/connectors', async (c) => c.json(await (await claude()).connectorsStatus(c.req.query('fresh') === '1')));

// ── Projects ───────────────────────────────────────────
app.get('/api/projects', async (c) => c.json(await listProjects()));
app.get('/api/projects/:id', async (c) => c.json(await readProject(c.req.param('id'))));
app.put('/api/projects/:id', async (c) => c.json(await writeProject(c.req.param('id'), await c.req.json())));
app.post('/api/projects/:id/duplicate', async (c) => {
  const id = c.req.param('id');
  const p = await readProject(id);
  const title = `${p.title} — копия`;
  const newId = await uniqueId(title);
  await duplicateProject(id, newId, title);
  // the copy starts its own version history
  await (await import('./git')).snapshot(newId, `копия проекта «${p.title}»`).catch(() => undefined);
  return c.json({projectId: newId});
});
app.delete('/api/projects/:id', async (c) => {
  const id = c.req.param('id');
  if ((await jobsMod()).runningJob(id)) return c.json({error: 'Агент сейчас работает в этом проекте — остановите его'}, 409);
  const to = await trashProject(id);
  // the deletion is a version too: git keeps everything up to it
  await (await import('./git')).snapshot(id, 'проект удалён').catch(() => undefined);
  return c.json({ok: true, trash: path.relative(path.dirname(path.dirname(to)), to)});
});

// ── Render ─────────────────────────────────────────────
app.post('/api/projects/:id/render', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {sceneId?: string};
  return c.json(await (await render()).startRender(c.req.param('id'), body.sceneId || undefined));
});
app.get('/api/projects/:id/render', async (c) => c.json((await render()).getRenderJob(c.req.param('id'))));

// ── Settings (secrets never leave the server) ──────────
app.get('/api/settings', async (c) => c.json(await publicSettings()));
app.put('/api/settings', async (c) => c.json(await updateSettings(await c.req.json())));

// ── Agent: create / recalc / chat ──────────────────────
const SAFE_NAME = (name: string) => name.replace(/[^\w.\-а-яё ]+/gi, '_').slice(-80) || 'file';
const LINK_MAX_FILES = 300;
const LINK_MAX_BYTES = 2 * 1024 ** 3;
const LOCAL_PATH = /^([a-z]:[\\/]|\\\\|\/|~[\\/])/i;

/** every file under a path (a file is itself), hidden ones skipped, at most LINK_MAX_FILES */
const walkFiles = async (p: string, out: string[] = []): Promise<string[]> => {
  const st = await fs.stat(p);
  if (st.isFile()) out.push(p);
  else if (st.isDirectory()) {
    for (const e of await fs.readdir(p)) {
      if (out.length >= LINK_MAX_FILES) break;
      if (!e.startsWith('.')) await walkFiles(path.join(p, e), out).catch(() => out);
    }
  }
  return out;
};

/**
 * «Ассеты по ссылке» of the creation form. Paths on this computer are copied into the asset bin
 * (inputs/assets/) right away; web links go to the agent. Returns the note for the brief.
 */
const importAssetLinks = async (id: string, links: string[]) => {
  const notes: string[] = [];
  const web: string[] = [];
  const {addAssets} = await assetsMod();
  for (const raw of links.map((l) => l.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean).slice(0, 20)) {
    if (!LOCAL_PATH.test(raw)) {
      web.push(raw);
      continue;
    }
    const src = raw.startsWith('~') ? path.join(os.homedir(), raw.slice(2)) : raw;
    const found = await walkFiles(src).catch(() => null);
    if (!found) {
      notes.push(`Путь «${raw}» не найден на этом компьютере — скажи об этом в итоге.`);
      continue;
    }
    let bytes = 0;
    let copied = 0;
    for (const f of found) {
      const size = (await fs.stat(f)).size;
      if (bytes + size > LINK_MAX_BYTES) break;
      bytes += size;
      await addAssets(id, [{name: path.basename(f), data: await fs.readFile(f)}]);
      copied++;
    }
    notes.push(
      `Из «${raw}» в корзину (inputs/assets/) скопировано файлов: ${copied}${copied < found.length ? ` из ${found.length} — остальное не влезло в лимит` : ''}.`,
    );
  }
  if (web.length) {
    notes.push(
      `Ассеты по веб-ссылкам: ${web.join(', ')} — открой, скачай нужное в inputs/assets/ и запиши в inputs/assets.json с ролью. Не открывается — скажи об этом в итоге.`,
    );
  }
  return notes.length ? `Ассеты по ссылкам:\n${notes.map((n) => `- ${n}`).join('\n')}` : '';
};

/** «Начать с» from the creation form: the second of the track where the video starts */
const musicFrom = (body: Record<string, unknown>) => {
  const v = Number([body.musicFrom].flat()[0]);
  return v > 0 ? {from: Math.round(v * 1000) / 1000} : {};
};

app.post('/api/projects', async (c) => {
  // all: a field sent several times (several references) arrives as an array
  const body = await c.req.parseBody({all: true});
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const title = String(one(body.title) ?? '').trim();
  if (!title) return c.json({error: 'Нужно название проекта'}, 400);
  const id = await uniqueId(title);
  const targetSeconds = Number(one(body.targetSeconds)) > 0 ? Number(one(body.targetSeconds)) : undefined;
  // «Настройки проекта» chosen in the form: style preset, ban list (JSON), own words
  const style = String(one(body.style) ?? '').trim() || 'custom';
  const bans = (() => {
    try {
      const v = JSON.parse(String(one(body.bans) ?? '[]'));
      return Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 40) : [];
    } catch {
      return [];
    }
  })();
  const styleNote = String(one(body.styleNote) ?? '').trim() || undefined;
  // build: frame format and fps
  const FORMATS: Record<string, [number, number]> = {'16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350]};
  const [width, height] = FORMATS[String(one(body.format) ?? '')] ?? FORMATS['16:9'];
  const fps = Number(one(body.fps)) === 30 ? 30 : 60;
  if (String(one(body.template) ?? '') === 'screen') {
    return c.json(await createScreenProject(id, title, body, {targetSeconds, width, height, fps, settings: {style, bans, ...(styleNote ? {styleNote} : {})}}));
  }
  const dir = await scaffoldProject(id, title, {
    targetSeconds,
    width,
    height,
    fps,
    settings: {style, bans, ...(styleNote ? {styleNote} : {})},
  });
  const files = (v: unknown) => ([] as unknown[]).concat(v ?? []).filter((f): f is File => f instanceof File && f.size > 0);
  const references: string[] = [];
  const refs = files(body.reference);
  for (const [i, f] of refs.entries()) {
    const name = refs.length > 1 ? `reference-${i + 1}-${SAFE_NAME(f.name)}` : `reference-${SAFE_NAME(f.name)}`;
    await fs.writeFile(path.join(dir, 'inputs', name), Buffer.from(await f.arrayBuffer()));
    references.push(name);
  }
  // the music goes to public/audio: the runtime plays it from settings.music under the whole video
  let music: string | undefined;
  for (const f of files(body.music).slice(0, 1)) {
    music = `audio/music-${SAFE_NAME(f.name)}`;
    await fs.writeFile(path.join(dir, 'public', music), Buffer.from(await f.arrayBuffer()));
    const p = await readProject(id);
    p.settings = {...(p.settings ?? {style, bans}), music: {file: music, gain: 1, ...musicFrom(body)}};
    await writeProject(id, p);
  }
  // files for the asset bin go straight into inputs/assets/ with a guessed role
  const assetFiles = files(body.asset);
  if (assetFiles.length) {
    const data = await Promise.all(assetFiles.map(async (f) => ({name: f.name, data: Buffer.from(await f.arrayBuffer())})));
    await (await assetsMod()).addAssets(id, data);
  }
  // assets by link: a path on this computer is copied into the bin now, a web link is left to the agent
  const linkNotes = await importAssetLinks(id, ([] as unknown[]).concat(body.assetLink ?? []).map(String));
  const figmaUrl = String(one(body.figmaUrl) ?? '').trim() || undefined;
  const brief = [String(one(body.brief) ?? '').trim(), linkNotes].filter(Boolean).join('\n\n');
  const {startJob} = await jobsMod();
  const {createPrompt} = await promptMod();
  const prompt = createPrompt({title, brief, figmaUrl, references, music, musicFrom: musicFrom(body).from, targetSeconds});
  // the second run (animation) reads the original inputs from here
  await fs.mkdir(path.join(dir, '.moootion'), {recursive: true});
  await fs.writeFile(path.join(dir, '.moootion', 'brief.md'), prompt, 'utf8');
  const job = await startJob({
    projectId: id,
    sceneId: null,
    kind: 'create',
    title: `Создание проекта «${title}»`,
    prompt,
    userText: [
      `Создай проект «${title}».`,
      figmaUrl ? `Раскадровка: ${figmaUrl}` : '',
      references.length > 1 ? `Референсы приложены (${references.length}).` : references.length ? 'Референс приложен.' : '',
      music ? 'Музыка приложена.' : '',
      targetSeconds ? `Длительность: ${targetSeconds} с.` : '',
      assetFiles.length ? `Ассетов в корзине: ${assetFiles.length}.` : '',
      brief ? `\n\n${brief}` : '',
    ]
      .filter(Boolean)
      .join(' '),
    maxTurns: 400,
    onDone: async () => {
      await (await render()).renderCover(id).catch((err) => console.error('cover failed', err));
    },
  });
  return c.json({projectId: id, jobId: job.id});
});

/** «Оживление скриншота»: N variant scenes with the background and the mockup in place, then one agent run */
const createScreenProject = async (
  id: string,
  title: string,
  body: Record<string, unknown>,
  o: {targetSeconds?: number; width: number; height: number; fps: number; settings: ProjectSettings},
) => {
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const text = (k: string) => String(one(body[k]) ?? '').trim();
  const files = (v: unknown) => ([] as unknown[]).concat(v ?? []).filter((f): f is File => f instanceof File && f.size > 0);
  const json = (k: string) => {
    try {
      return JSON.parse(text(k));
    } catch {
      return null;
    }
  };
  const figmaUrl = text('figmaUrl');
  if (!/figma\.com\/(design|file)\//.test(figmaUrl)) throw new Error('Нужна ссылка на кадр интерфейса в Figma');
  const material = path.basename(text('mockup'));
  const bgFile = files(body.bgImage)[0];
  const background = bgFile
    ? {type: 'image' as const, file: `bg/${SAFE_NAME(bgFile.name)}`, fit: 'cover' as const}
    : (BackgroundSchema.safeParse(json('background')).data ?? {type: 'shader' as const, shader: 'mesh', speed: 1});
  // the mockup is copied after the scaffold made the folder; its geometry goes into the manifest now
  const meta = material ? JSON.parse(await fs.readFile(path.join(LIBRARY, 'mockups', material, 'meta.json'), 'utf8')) : null;
  const mockup: ScreenTemplate['mockup'] = meta ? {material: meta.id, file: `mockup/${material}.png`, size: meta.size, screen: meta.screen} : undefined;
  const screen = ScreenTemplateSchema.parse({
    figmaUrl,
    endFrameUrl: text('endFrameUrl') || undefined,
    background,
    preset: text('preset') || 'dribbble',
    intensity: Number(text('intensity')) || 2,
    variants: Number(text('variants')) || 2,
    mockup,
    aiVideo: text('aiVideo') === '1',
    prompt: text('prompt') || undefined,
  });
  const seconds = Math.min(5, Math.max(2, o.targetSeconds ?? 4));
  const dir = await scaffoldScreenProject(id, title, {screen, seconds, settings: o.settings, width: o.width, height: o.height, fps: o.fps});
  if (mockup) await installMockup(id, material);
  if (bgFile && background.type === 'image') {
    await fs.mkdir(path.join(dir, 'public', 'bg'), {recursive: true});
    await fs.writeFile(path.join(dir, 'public', background.file), Buffer.from(await bgFile.arrayBuffer()));
  }
  const references: string[] = [];
  for (const [i, f] of files(body.reference).entries()) {
    const name = `reference-${i + 1}-${SAFE_NAME(f.name)}`;
    await fs.writeFile(path.join(dir, 'inputs', name), Buffer.from(await f.arrayBuffer()));
    references.push(name);
  }
  let music: string | undefined;
  for (const f of files(body.music).slice(0, 1)) {
    music = `audio/music-${SAFE_NAME(f.name)}`;
    await fs.writeFile(path.join(dir, 'public', music), Buffer.from(await f.arrayBuffer()));
    const p = await readProject(id);
    p.settings = {...(p.settings ?? o.settings), music: {file: music, gain: 1, ...musicFrom(body)}};
    await writeProject(id, p);
  }
  const {startJob} = await jobsMod();
  const {createScreenPrompt} = await promptMod();
  const prompt = createScreenPrompt({title, variants: screen.variants, references, music, musicFrom: musicFrom(body).from});
  await fs.mkdir(path.join(dir, '.moootion'), {recursive: true});
  await fs.writeFile(path.join(dir, '.moootion', 'brief.md'), prompt, 'utf8');
  const job = await startJob({
    projectId: id,
    sceneId: null,
    kind: 'create',
    title: `Оживление экрана «${title}»`,
    prompt,
    userText: [
      `Оживи экран: ${figmaUrl}`,
      `${screen.variants} вар. по ${seconds} с, интенсивность ${screen.intensity}.`,
      screen.endFrameUrl ? `Конечное состояние: ${screen.endFrameUrl}` : '',
      mockup ? `Мокап: ${material}.` : '',
      screen.aiVideo ? 'Движение — ИИ-видео (Magnific).' : '',
      screen.prompt ? `\n\n${screen.prompt}` : '',
    ]
      .filter(Boolean)
      .join(' '),
    maxTurns: 400,
    onDone: async () => {
      await (await render()).renderCover(id).catch((err) => console.error('cover failed', err));
    },
  });
  return {projectId: id, jobId: job.id};
};

// the contact sheet of key poses: «Утвердить» starts the animation run, «Поправить» re-renders the poses
app.post('/api/projects/:id/poses', async (c) => {
  const id = c.req.param('id');
  const b = (await c.req.json().catch(() => ({}))) as {messageId?: string; approve?: boolean; notes?: {title: string; text: string}[]; general?: string};
  if (!b.messageId) return c.json({error: 'Нет messageId'}, 400);
  const {startJob, runningJob, setPosesState} = await jobsMod();
  if (runningJob(id)) return c.json({error: 'Агент сейчас работает — дождитесь окончания'}, 409);
  const notes = [
    ...(b.notes ?? []).filter((n) => n.text?.trim()).map((n) => `- кадр «${n.title}»: ${n.text.trim()}`),
    ...(b.general?.trim() ? [`- в целом: ${b.general.trim()}`] : []),
  ].join('\n');
  if (!b.approve && !notes) return c.json({error: 'Напишите, что поправить, или утвердите позы'}, 400);
  await setPosesState(id, b.messageId, b.approve ? 'approved' : 'revised');
  const {animatePrompt, posesFixPrompt} = await promptMod();
  const job = await startJob({
    projectId: id,
    sceneId: null,
    kind: 'create',
    title: b.approve ? 'Анимация по утверждённым позам' : 'Правка ключевых поз',
    prompt: b.approve ? animatePrompt(notes) : posesFixPrompt(notes),
    poses: !b.approve,
    userText: b.approve ? `Позы утверждены — анимируй.${notes ? `\n${notes}` : ''}` : `Поправь позы:\n${notes}`,
    maxTurns: 400,
    onDone: async () => {
      await (await render()).renderCover(id).catch((err) => console.error('cover failed', err));
    },
  });
  return c.json({jobId: job.id});
});

app.post('/api/projects/:id/recalc', async (c) => {
  const id = c.req.param('id');
  const {sceneId} = (await c.req.json().catch(() => ({}))) as {sceneId?: string | null};
  const project = await readProject(id);
  const scenes = sceneId ? project.scenes.filter((s) => s.id === sceneId) : project.scenes;
  const items = scenes.flatMap((s) =>
    s.backlog.map((b) => {
      const a = s.actions.find((x) => x.id === b.actionId);
      const where = `${b.at.toFixed(2).replace('.', ',')} с${a ? `, действие «${a.title}» (${a.id})` : ''}`;
      const kind = b.kind === 'comment' ? 'Комментарий' : b.kind === 'effect' ? 'Замена эффекта' : 'Задача';
      return {id: b.id, text: `- [${kind}] сцена «${s.title}», ${where}: ${b.text || '(шов без текста — предложи эффект на стыке)'}`};
    }),
  );
  if (!items.length) return c.json({error: 'Правок нет — добавьте правку или напишите в чат'}, 400);
  const {describeLiveEdits, lastCommittedManifest} = await import('./diff');
  const liveEdits = describeLiveEdits(await lastCommittedManifest(id), project, sceneId ?? null);
  const sentIds = new Set(items.map((i) => i.id));
  const {startJob} = await jobsMod();
  const {recalcPrompt} = await promptMod();
  const sceneTitle = sceneId ? (scenes[0]?.title ?? sceneId) : 'весь проект';
  const job = await startJob({
    projectId: id,
    sceneId: sceneId ?? null,
    kind: 'recalc',
    title: `Пересчёт: ${sceneTitle} (${items.length})`,
    prompt: recalcPrompt({sceneTitle, backlog: items.map((i) => i.text).join('\n'), liveEdits}),
    userText: `Пересчитать «${sceneTitle}»: правок — ${items.length}.`,
    fast: true,
    onDone: async () => {
      // the agent handled these items — take them off the backlog
      const fresh = await readProject(id);
      for (const s of fresh.scenes) s.backlog = s.backlog.filter((b) => !sentIds.has(b.id));
      await writeProject(id, fresh);
    },
  });
  return c.json({jobId: job.id});
});

app.post('/api/projects/:id/resume', async (c) => {
  const id = c.req.param('id');
  const {resumeJob} = await jobsMod();
  const job = await resumeJob(id, async (j) => {
    if (j.kind === 'create') await (await render()).renderCover(id).catch((err) => console.error('cover failed', err));
  });
  return c.json({jobId: job.id});
});

app.post('/api/projects/:id/chat', async (c) => {
  const id = c.req.param('id');
  const b = (await c.req.json()) as {
    sceneId: string | null;
    message: string;
    playhead: number;
    selected?: string;
    attachments?: {name: string; path: string; url: string; type: string; size: number}[];
  };
  // chat attachments, or files from the asset bin dragged into the message
  const attachments = (b.attachments ?? []).filter((a) => /^inputs\/(attachments|assets)\/[^/]+$/.test(a.path));
  if (!b.message?.trim() && !b.attachments?.length) return c.json({error: 'Пустое сообщение'}, 400);
  if (!b.message?.trim()) b.message = 'Посмотри вложения.';
  const project = await readProject(id);
  const scene = project.scenes.find((s) => s.id === b.sceneId);
  const {startJob} = await jobsMod();
  const {chatPrompt} = await promptMod();
  const job = await startJob({
    projectId: id,
    sceneId: b.sceneId,
    kind: 'chat',
    title: b.message.trim().slice(0, 60),
    prompt: chatPrompt({
      sceneTitle: scene?.title ?? null,
      message: b.message.trim(),
      playhead: b.playhead,
      selected: b.selected,
      attachments: attachments.map((a) => a.path),
    }),
    userText: b.message.trim(),
    userAttachments: attachments,
    // attachments usually mean new material: straight to the main model
    fast: !attachments.length,
  });
  return c.json({jobId: job.id});
});

app.get('/api/projects/:id/chat', async (c) => {
  const {readChat, runningJob, resumable} = await jobsMod();
  const id = c.req.param('id');
  const running = runningJob(id);
  return c.json({
    messages: await readChat(id),
    running: running ? {id: running.id, title: running.title, kind: running.kind} : null,
    // a stopped run that «Запустить снова» can restart
    resumable: await resumable(id),
  });
});

app.get('/api/projects/:id/usage', async (c) => c.json(await (await jobsMod()).projectUsage(c.req.param('id'))));

// ── Asset bin (inputs/assets/ + inputs/assets.json) ────
const assetsMod = () => import('./assets');
app.get('/api/projects/:id/assets', async (c) => c.json(await (await assetsMod()).listAssets(c.req.param('id'))));
app.post('/api/projects/:id/assets', async (c) => {
  const body = await c.req.parseBody({all: true});
  const files = ([] as unknown[]).concat(body.files ?? []).filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return c.json({error: 'Нет файлов'}, 400);
  const big = files.find((f) => f.size > 500 * 1024 * 1024);
  if (big) return c.json({error: `Файл ${big.name} больше 500 МБ`}, 400);
  const data = await Promise.all(files.map(async (f) => ({name: f.name, data: Buffer.from(await f.arrayBuffer())})));
  const role = typeof body.role === 'string' ? body.role : undefined;
  return c.json(await (await assetsMod()).addAssets(c.req.param('id'), data, role));
});
app.patch('/api/projects/:id/assets/:file', async (c) => {
  const patch = (await c.req.json().catch(() => ({}))) as {role?: string; tags?: string[]};
  return c.json(await (await assetsMod()).updateAsset(c.req.param('id'), c.req.param('file'), patch));
});
app.delete('/api/projects/:id/assets/:file', async (c) =>
  c.json(await (await assetsMod()).removeAsset(c.req.param('id'), c.req.param('file'))),
);

// ── Project music («Настройки проекта») ───────────────
app.post('/api/projects/:id/music', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.parseBody();
  const f = body.file;
  if (!(f instanceof File) || !f.size) return c.json({error: 'Нет файла'}, 400);
  if (!/^audio\//.test(f.type) && !/\.(mp3|wav|m4a|aac|ogg)$/i.test(f.name)) return c.json({error: 'Нужен аудиофайл (mp3, wav, m4a)'}, 400);
  const dir = path.join(projectDir(id), 'public', 'audio');
  await fs.mkdir(dir, {recursive: true});
  const file = `audio/music-${SAFE_NAME(f.name)}`;
  await fs.writeFile(path.join(projectDir(id), 'public', file), Buffer.from(await f.arrayBuffer()));
  return c.json({file});
});

// ── Chat attachments ───────────────────────────────────
app.post('/api/projects/:id/attachments', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.parseBody({all: true});
  const files = ([] as unknown[]).concat(body.files ?? []).filter((f): f is File => f instanceof File && f.size > 0);
  const dir = path.join(projectDir(id), 'inputs', 'attachments');
  await fs.mkdir(dir, {recursive: true});
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const saved = [];
  for (const [i, f] of files.entries()) {
    if (f.size > 300 * 1024 * 1024) return c.json({error: `Файл ${f.name} больше 300 МБ`}, 400);
    const name = `${stamp}-${i}-${SAFE_NAME(f.name)}`;
    await fs.writeFile(path.join(dir, name), Buffer.from(await f.arrayBuffer()));
    const rel = `inputs/attachments/${name}`;
    saved.push({name: f.name, path: rel, url: `/files/${id}/${rel}`, type: f.type || 'application/octet-stream', size: f.size});
  }
  return c.json(saved);
});

// ── Versions (git snapshots before/after every agent run) ──
app.get('/api/projects/:id/versions', async (c) => c.json(await (await import('./git')).listVersions(c.req.param('id'))));
app.post('/api/projects/:id/versions', async (c) => {
  const {snapshot} = await import('./git');
  // a manual save of one action carries what changed: «правка: «Покачивание»» + the details in the body
  const b = (await c.req.json().catch(() => ({}))) as {title?: string; detail?: string};
  const subject = b.title ? `правка: ${b.title.replace(/\s+/g, ' ').slice(0, 120)}` : 'версия: сохранено вручную';
  const message = b.detail ? `${subject}\n\n${b.detail.slice(0, 2000)}` : subject;
  return c.json({head: await snapshot(c.req.param('id'), message)});
});
app.post('/api/projects/:id/versions/:hash', async (c) => {
  const id = c.req.param('id');
  const {runningJob} = await jobsMod();
  if (runningJob(id)) return c.json({error: 'Агент сейчас работает над проектом — дождитесь окончания'}, 409);
  const {label} = (await c.req.json().catch(() => ({}))) as {label?: string};
  const head = await (await import('./git')).switchVersion(id, c.req.param('hash'), label ?? c.req.param('hash').slice(0, 7));
  return c.json({head});
});

// layer names the code wraps in <Layer>: the studio greys out hide/mute/reorder for the rest.
// Names are often passed through variables (name={layers.header}), so besides literal
// <Layer name="…"> a manifest layer name counts when it is quoted anywhere in code that uses <Layer>.
app.get('/api/projects/:id/layers', async (c) => {
  const id = c.req.param('id');
  const names = new Set<string>();
  let src = '';
  const walk = async (d: string) => {
    for (const e of await fs.readdir(d, {withFileTypes: true}).catch(() => [])) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.tsx?$/.test(e.name)) {
        const text = await fs.readFile(p, 'utf8').catch(() => '');
        src += text;
        for (const m of text.matchAll(/<Layer\s[^>]*?name=(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g)) names.add(m[1] ?? m[2] ?? m[3]);
      }
    }
  };
  await walk(path.join(projectDir(id), 'src'));
  if (src.includes('<Layer')) {
    const project = await readProject(id).catch(() => null);
    for (const s of project?.scenes ?? []) {
      for (const a of s.actions) {
        const n = a.layer;
        if (src.includes(`'${n}'`) || src.includes(`"${n}"`) || src.includes(`\`${n}\``)) names.add(n);
      }
    }
  }
  return c.json([...names]);
});

app.get('/api/jobs/:id', async (c) => {
  const {getJob} = await jobsMod();
  const job = getJob(c.req.param('id'));
  if (!job) return c.json({error: 'Задача не найдена'}, 404);
  const since = Number(c.req.query('since') ?? 0);
  return c.json({...job, log: job.log.slice(since), logTotal: job.log.length});
});
// a paid Magnific call: the chat card answers «Разрешить» / «Отклонить»
app.post('/api/jobs/:id/approve', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as {approvalId?: string; allow?: boolean};
  if (!b.approvalId) return c.json({error: 'Нет approvalId'}, 400);
  try {
    return c.json((await jobsMod()).answerApproval(c.req.param('id'), b.approvalId, Boolean(b.allow)));
  } catch (err) {
    return c.json({error: (err as Error).message}, 409);
  }
});
app.post('/api/jobs/:id/stop', async (c) => c.json((await jobsMod()).stopJob(c.req.param('id'))));
app.post('/api/jobs/:id/rollback', async (c) => c.json(await (await jobsMod()).rollbackJob(c.req.param('id'))));

// ── Files ──────────────────────────────────────────────
const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.gif': 'image/gif',
  '.json': 'application/json',
};

/**
 * Files answer byte ranges (HTTP 206): a browser can only jump into the middle of an mp3 or a video when the server
 * gives it that part. Without this the preview's music kept snapping back to 0 — a stream of seeks heard as clicks.
 */
const sendFile = async (file: string, req?: Request) => {
  const st = await fs.stat(file);
  if (!st.isFile()) throw new Error('not a file');
  const headers: Record<string, string> = {
    'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
    'accept-ranges': 'bytes',
  };
  const body = (start?: number, end?: number) => Readable.toWeb(createReadStream(file, {start, end})) as ReadableStream;
  const m = /^bytes=(\d*)-(\d*)$/.exec(req?.headers.get('range')?.trim() ?? '');
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : st.size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : st.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, st.size - 1);
    if (start > end || start >= st.size) {
      return new Response(null, {status: 416, headers: {...headers, 'content-range': `bytes */${st.size}`}});
    }
    return new Response(body(start, end), {
      status: 206,
      headers: {...headers, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': String(end - start + 1)},
    });
  }
  return new Response(body(), {headers: {...headers, 'content-length': String(st.size)}});
};

// project files: /files/<id>/<path inside public/>, and /files/<id>/.moootion/…
app.get('/files/:id/*', async (c) => {
  const id = c.req.param('id');
  const rel = decodeURIComponent(c.req.path.slice(`/files/${id}/`.length));
  const base = rel.startsWith('.moootion/') || rel.startsWith('inputs/') ? projectDir(id) : path.join(projectDir(id), 'public');
  const file = path.resolve(base, rel);
  if (!file.startsWith(projectDir(id))) return c.text('forbidden', 403);
  return sendFile(file, c.req.raw).catch(() => c.text('not found', 404));
});

// shared library (mockup thumbnails for the template form)
app.get('/library/*', async (c) => {
  const file = path.resolve(LIBRARY, decodeURIComponent(c.req.path.slice('/library/'.length)));
  if (!file.startsWith(LIBRARY)) return c.text('forbidden', 403);
  return sendFile(file, c.req.raw).catch(() => c.text('not found', 404));
});
// the mockup list with each device's geometry (for the big preview in the form)
app.get('/api/mockups', async (c) => {
  const index = JSON.parse(await fs.readFile(path.join(LIBRARY, 'mockups', 'index.json'), 'utf8').catch(() => '[]')) as {id: string}[];
  const out = [];
  for (const m of index) {
    const meta = JSON.parse(await fs.readFile(path.join(LIBRARY, 'mockups', m.id, 'meta.json'), 'utf8').catch(() => '{}'));
    out.push({...m, material: meta.material, size: meta.size, screen: meta.screen});
  }
  return c.json(out);
});

/** copies a library mockup into the project's public/ — its own file name, so the preview never shows a cached one */
const installMockup = async (projectId: string, material: string) => {
  const m = path.basename(material);
  const meta = JSON.parse(await fs.readFile(path.join(LIBRARY, 'mockups', m, 'meta.json'), 'utf8'));
  const file = `mockup/${m}.png`;
  await fs.mkdir(path.join(projectDir(projectId), 'public', 'mockup'), {recursive: true});
  await fs.copyFile(path.join(LIBRARY, 'mockups', m, 'device.png'), path.join(projectDir(projectId), 'public', file));
  return {material: meta.id as string, file, size: meta.size as [number, number], screen: meta.screen as {x: number; y: number; w: number; h: number; r: number}};
};
app.post('/api/projects/:id/mockup', async (c) => {
  const {material} = (await c.req.json().catch(() => ({}))) as {material?: string};
  if (!material) return c.json({error: 'Нет мокапа'}, 400);
  return c.json(await installMockup(c.req.param('id'), material));
});
app.post('/api/projects/:id/background-image', async (c) => {
  const body = await c.req.parseBody();
  const f = body.file;
  if (!(f instanceof File) || !f.size) return c.json({error: 'Нет файла'}, 400);
  if (!/^image\//.test(f.type)) return c.json({error: 'Нужна картинка'}, 400);
  const file = `bg/${Date.now().toString(36)}-${SAFE_NAME(f.name)}`;
  await fs.mkdir(path.join(projectDir(c.req.param('id')), 'public', 'bg'), {recursive: true});
  await fs.writeFile(path.join(projectDir(c.req.param('id')), 'public', file), Buffer.from(await f.arrayBuffer()));
  return c.json({file});
});

app.get('/renders/:name', async (c) => {
  const file = path.resolve(RENDERS, c.req.param('name'));
  if (!file.startsWith(RENDERS)) return c.text('forbidden', 403);
  const res = await sendFile(file, c.req.raw).catch(() => null);
  if (!res) return c.text('not found', 404);
  // ?download=1&as=<file name> — save to disk instead of playing in the tab
  if (c.req.query('download')) {
    const as = (c.req.query('as') || path.basename(file)).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'video.mp4';
    res.headers.set('content-disposition', `attachment; filename="video.mp4"; filename*=UTF-8''${encodeURIComponent(as)}`);
  }
  return res;
});

const port = Number(process.env.MOOOTION_API_PORT ?? 8787);
serve({fetch: app.fetch, port}, () => {
  console.log(`moootion api → http://localhost:${port}`);
  jobsMod()
    .then((m) => m.recoverInterruptedJobs())
    .catch((err) => console.error('job recovery failed', err));
  // the first start shows a finished example: the demo showreel becomes the first project
  (async () => {
    const demo = path.join(ROOT, 'templates', 'demo');
    if (!(await fs.stat(path.join(demo, 'project.json')).catch(() => null))) return;
    if ((await listProjects()).length) return;
    await fs.cp(demo, projectDir('demo'), {recursive: true});
    console.log('first start: demo project added');
  })().catch((err) => console.error('demo copy failed', err));
  promptMod()
    .then((m) => m.detectPython())
    .then((py) => console.log(py ? `python: ${py.cmd}${py.cv2 ? ' + cv2' : ''}${py.pil ? ' + PIL' : ''}` : 'python: нет (необязательно)'))
    .catch(() => undefined);
});
