import {create} from 'zustand';
import type {Action, BacklogItem, Project, Scene, SceneLayer} from '../../runtime/manifest';
import type {Stages} from '../../runtime/timeline';
import {api, type Attachment, type Job, type LogLine, type ProjectSummary, type Resumable} from './api';
import {loadStages} from './projectCode';

export type Selection = {sceneId: string; actionId: string} | null;
export type LayerSelection = {sceneId: string; name: string} | null;
export type Modal = null | 'new-project' | 'library' | 'settings' | 'project-settings' | 'shortcuts';
export type PanelTab = 'chat' | 'edits' | 'assets';
export type ChatDraft = {text: string; attachments: Attachment[]};
export type PreviewSize = 'S' | 'M' | 'L';

type State = {
  projects: ProjectSummary[];
  project: Project | null;
  stages: Stages | null;
  /** the scene code does not compile (the agent may be halfway through writing it): the project stays open */
  codeError: string | null;
  loadError: string | null;
  /** null = «Весь проект» */
  sceneId: string | null;
  selected: Selection;
  /** a layer picked in the preview or in the scheme (its actions are highlighted) */
  selectedLayer: LayerSelection;
  /** layer names the project's code wraps in <Layer> (hide/mute/reorder work only for these) */
  codeLayers: string[];
  /** project time, seconds */
  playhead: number;
  playing: boolean;
  previewOpen: boolean;
  /** «play this card»: the big preview plays [from, to) seconds once; `n` makes a repeat click a new request */
  playRange: {from: number; to: number; n: number} | null;
  /** an edit of the selected action replays its stretch in the big preview */
  autoReplay: boolean;
  panelOpen: boolean;
  sidebarOpen: boolean;
  /** timeline zoom */
  pxPerSec: number;
  scrollX: number;
  /** width of the time viewport, px */
  viewW: number;
  /** the user zoomed manually (don't auto-fit) */
  zoomed: boolean;
  past: Project[];
  future: Project[];
  save: 'saved' | 'dirty' | 'saving' | 'error';
  modal: Modal;
  panelTab: PanelTab;
  /** the agent job the user is following */
  activeJobId: string | null;
  /** the last run of the project was stopped — the main button restarts it */
  resumable: Resumable | null;
  /** the followed job and its log so far (filled by useJobFollow, read by the chat) */
  job: Job | null;
  jobLog: LogLine[];
  /** bumped when a job ends: the chat refetches its history */
  chatVersion: number;
  /** bumped whenever the agent changed the project's code/manifest (job finished, rollback) */
  codeVersion: number;
  /** drawer height, px */
  drawerH: number;
  /** heights the user set by dragging, per tab (otherwise each tab opens at its default) */
  drawerHeights: Partial<Record<PanelTab, number>>;
  /** unsent chat message per project — survives tab switches */
  chatDrafts: Record<string, ChatDraft>;
  /** files being uploaded for the chat draft */
  uploading: number;
  /** files are being dragged over the studio */
  fileDrag: boolean;
  /** an edit to scroll to and highlight in the «Правки» tab (a marker on the ruler was clicked) */
  focusEdit: string | null;
  /** each action as it was when last saved (or first opened): the inspector shows what changed since */
  baselines: Record<string, Action>;
  /** the floating preview of the selected action's stretch */
  actionPreview: {open: boolean; size: PreviewSize};
  /** the user's height for the cards row (drag the divider under it) */
  cardH: number;
  /** layers opened into one row per action (key scene/layer); `all` opens every layer */
  openLayers: {all: boolean; keys: Record<string, boolean>};

  loadProjects: () => Promise<void>;
  openProject: (id: string) => Promise<void>;
  /** re-read manifest + code after the agent changed them, keeping the view */
  reloadProject: () => Promise<void>;
  setModal: (m: Modal) => void;
  setPanelTab: (t: PanelTab) => void;
  setActiveJob: (id: string | null) => void;
  setResumable: (r: Resumable | null) => void;
  setJobState: (job: Job | null, log: LogLine[]) => void;
  bumpChat: () => void;
  setDrawerH: (h: number) => void;
  setChatDraft: (projectId: string, draft: Partial<ChatDraft>) => void;
  /** upload files and add them to the open project's chat draft */
  attachFiles: (files: File[]) => Promise<void>;
  /** files already in the project (the asset bin) join the chat draft without an upload */
  attachExisting: (atts: Attachment[]) => void;
  setFileDrag: (v: boolean) => void;
  /** open «Правки» on one edit: playhead to its frame, the item highlighted */
  openEdit: (sceneId: string, id: string) => void;
  /** put one field (start, duration, title, curve, params.<k>) or the whole action back to its baseline */
  resetAction: (sceneId: string, actionId: string, field?: string) => void;
  /** record the action's changes as a version and make them the new baseline */
  saveAction: (sceneId: string, actionId: string) => Promise<void>;
  setActionPreview: (v: Partial<{open: boolean; size: PreviewSize}>) => void;
  setCardH: (h: number) => void;
  toggleLayerOpen: (key: string) => void;
  setAllLayersOpen: (v: boolean) => void;
  setScene: (id: string | null) => void;
  select: (sel: Selection) => void;
  selectLayer: (sel: LayerSelection) => void;
  /** hide / mute a layer; the scene's layer list is written out in full on first touch */
  setLayer: (sceneId: string, name: string, patch: Partial<Omit<SceneLayer, 'name'>>) => void;
  /** move a layer up (+1, towards the viewer) or down (-1) in the stacking order */
  moveLayer: (sceneId: string, name: string, dir: 1 | -1) => void;
  /** stretch a scene (or every scene when null) by k: starts, lengths, subscenes, backlog */
  scaleScene: (sceneId: string | null, k: number) => void;
  /** shift everything after the point (project seconds) by d seconds */
  insertPause: (at: number, d: number) => void;
  setTargetSeconds: (v: number | undefined) => void;
  setPlayhead: (s: number) => void;
  setPlaying: (v: boolean) => void;
  setPreviewOpen: (v: boolean) => void;
  /** open the big preview and play this stretch of the film (seconds) */
  playStretch: (from: number, to: number) => void;
  setAutoReplay: (v: boolean) => void;
  setPanelOpen: (v: boolean) => void;
  setSidebarOpen: (v: boolean) => void;
  setView: (v: {pxPerSec?: number; scrollX?: number; viewW?: number; zoomed?: boolean}) => void;
  /** mutate the manifest; history=false while a drag is in progress */
  edit: (recipe: (p: Project) => void, opts?: {history?: boolean}) => void;
  /** push one history step before a continuous gesture (drag) */
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  addBacklog: (sceneId: string, item: Omit<BacklogItem, 'id' | 'createdAt'>) => void;
  removeBacklog: (sceneId: string, id: string) => void;
};

const MAX_HISTORY = 200;

export const useStudio = create<State>((set, get) => ({
  projects: [],
  project: null,
  stages: null,
  codeError: null,
  loadError: null,
  sceneId: null,
  selected: null,
  selectedLayer: null,
  codeLayers: [],
  playhead: 0,
  playing: false,
  previewOpen: false,
  playRange: null,
  autoReplay: localStorage.getItem('moootion:autoReplay') !== '0',
  panelOpen: false,
  sidebarOpen: true,
  pxPerSec: 100,
  scrollX: 0,
  viewW: 1200,
  zoomed: false,
  past: [],
  future: [],
  save: 'saved',
  modal: null,
  panelTab: 'chat',
  activeJobId: null,
  resumable: null,
  job: null,
  jobLog: [],
  chatVersion: 0,
  codeVersion: 0,
  drawerH: 520,
  drawerHeights: readDrawerHeights(),
  chatDrafts: {},
  uploading: 0,
  fileDrag: false,
  focusEdit: null,
  baselines: {},
  actionPreview: readActionPreview(),
  cardH: Number(localStorage.getItem('moootion:cardH')) || 180,
  openLayers: {all: localStorage.getItem('moootion:layersOpen') === '1', keys: {}},

  loadProjects: async () => set({projects: await api.projects()}),

  openProject: async (id) => {
    try {
      // a project whose code does not compile still opens: timeline, chat and the agent's progress stay in view
      const [project, code, codeLayers] = await Promise.all([api.project(id), tryStages(id), api.codeLayers(id).catch(() => [] as string[])]);
      set({
        project,
        stages: code.stages ?? {},
        codeError: code.error,
        codeLayers,
        loadError: null,
        sceneId: project.scenes.length === 1 ? project.scenes[0].id : null,
        selected: null,
        selectedLayer: null,
        baselines: {},
        playhead: 0,
        scrollX: 0,
        zoomed: false,
        past: [],
        future: [],
        save: 'saved',
      });
      localStorage.setItem('moootion:lastProject', id);
    } catch (err) {
      set({loadError: err instanceof Error ? err.message : String(err)});
    }
  },

  reloadProject: async () => {
    const cur = get().project;
    if (!cur) return;
    const [project, code, codeLayers] = await Promise.all([
      api.project(cur.id),
      tryStages(cur.id),
      api.codeLayers(cur.id).catch(() => get().codeLayers),
    ]);
    const sceneId = get().sceneId;
    set({
      project,
      // half-written code keeps the last scenes that compiled on screen
      stages: code.stages ?? get().stages ?? {},
      codeError: code.error,
      codeLayers,
      sceneId: sceneId && project.scenes.some((s) => s.id === sceneId) ? sceneId : project.scenes.length === 1 ? project.scenes[0].id : null,
      selected: null,
      // the agent may have changed the actions: «what changed» starts over
      baselines: {},
      past: [],
      future: [],
      save: 'saved',
      codeVersion: get().codeVersion + 1,
    });
    get().loadProjects();
  },
  setModal: (modal) => set({modal}),
  // each tab opens at its own height: the chat as tall as it gets, the lists keep the cards in view
  setPanelTab: (panelTab) => set((s) => ({panelTab, panelOpen: true, drawerH: s.drawerHeights[panelTab] ?? defaultDrawerH(panelTab)})),
  setActiveJob: (activeJobId) => set({activeJobId, ...(activeJobId ? {resumable: null} : {job: null, jobLog: []})}),
  setResumable: (resumable) => set({resumable}),
  setJobState: (job, jobLog) => set({job, jobLog}),
  bumpChat: () => set((s) => ({chatVersion: s.chatVersion + 1})),
  setDrawerH: (h) => {
    const drawerH = Math.round(Math.min(maxDrawerH(), Math.max(240, h)));
    const tab = get().panelTab;
    localStorage.setItem(`moootion:drawerH:${tab}`, String(drawerH));
    set((s) => ({drawerH, drawerHeights: {...s.drawerHeights, [tab]: drawerH}}));
  },
  attachFiles: async (files) => {
    const p = get().project;
    if (!p || !files.length) return;
    set((s) => ({uploading: s.uploading + files.length}));
    try {
      const saved = await api.uploadAttachments(p.id, files);
      const cur = get().chatDrafts[p.id] ?? {text: '', attachments: []};
      get().setChatDraft(p.id, {attachments: [...cur.attachments, ...saved]});
    } finally {
      set((s) => ({uploading: s.uploading - files.length}));
    }
  },
  attachExisting: (atts) => {
    const p = get().project;
    if (!p || !atts.length) return;
    const cur = get().chatDrafts[p.id] ?? {text: '', attachments: []};
    const fresh = atts.filter((a) => !cur.attachments.some((x) => x.path === a.path));
    get().setChatDraft(p.id, {attachments: [...cur.attachments, ...fresh]});
    get().setPanelTab('chat');
  },
  setFileDrag: (fileDrag) => set({fileDrag}),
  resetAction: (sceneId, actionId, field) => {
    const base = get().baselines[`${sceneId}/${actionId}`];
    if (!base) return;
    get().edit((p) => {
      const a = p.scenes.find((s) => s.id === sceneId)?.actions.find((x) => x.id === actionId);
      if (!a) return;
      if (!field) {
        Object.assign(a, structuredClone(base));
        return;
      }
      if (field.startsWith('params.')) {
        const k = field.slice(7);
        a.params = {...(a.params ?? {})};
        if (base.params && k in base.params) a.params[k] = base.params[k];
        else delete a.params[k];
        return;
      }
      const key = field as 'start' | 'duration' | 'title' | 'curve';
      (a as Record<string, unknown>)[key] = structuredClone(base[key]);
    });
  },

  saveAction: async (sceneId, actionId) => {
    const p = get().project;
    const key = `${sceneId}/${actionId}`;
    const base = get().baselines[key];
    const a = p?.scenes.find((s) => s.id === sceneId)?.actions.find((x) => x.id === actionId);
    if (!p || !a) return;
    const changes = base ? describeActionChanges(base, a, p.fps) : [];
    if (!changes.length) return;
    // the edit is already on screen; write it to disk now (not after the autosave delay), then snapshot
    set({save: 'saving'});
    await api.saveProject(p);
    set({save: 'saved'});
    await api.saveVersion(p.id, {title: `«${a.title}»`, detail: changes.join('; ')});
    set((s) => ({baselines: {...s.baselines, [key]: structuredClone(a)}}));
  },

  setActionPreview: (v) =>
    set((s) => {
      const actionPreview = {...s.actionPreview, ...v};
      localStorage.setItem('moootion:actionPreview', JSON.stringify(actionPreview));
      return {actionPreview};
    }),

  toggleLayerOpen: (key) =>
    set((s) => {
      // with «all» on, closing one layer turns «all» off and keeps the others open
      if (s.openLayers.all) {
        const keys: Record<string, boolean> = {};
        for (const sc of s.project?.scenes ?? []) for (const a of sc.actions) keys[`${sc.id}/${a.layer}`] = true;
        delete keys[key];
        localStorage.setItem('moootion:layersOpen', '0');
        return {openLayers: {all: false, keys}};
      }
      return {openLayers: {all: false, keys: {...s.openLayers.keys, [key]: !s.openLayers.keys[key]}}};
    }),
  setAllLayersOpen: (v) => {
    localStorage.setItem('moootion:layersOpen', v ? '1' : '0');
    set({openLayers: {all: v, keys: {}}});
  },

  setCardH: (h) => {
    const cardH = Math.round(Math.min(window.innerHeight * 0.55, Math.max(110, h)));
    localStorage.setItem('moootion:cardH', String(cardH));
    set({cardH});
  },

  openEdit: (sceneId, id) => {
    const p = get().project;
    const item = p?.scenes.find((s) => s.id === sceneId)?.backlog.find((b) => b.id === id);
    if (!p || !item) return;
    get().setPlayhead((sceneOffsets(p).get(sceneId) ?? 0) + item.at);
    get().setPanelTab('edits');
    set({focusEdit: id});
  },
  setChatDraft: (projectId, draft) =>
    set((s) => {
      const cur = s.chatDrafts[projectId] ?? {text: '', attachments: []};
      return {chatDrafts: {...s.chatDrafts, [projectId]: {...cur, ...draft}}};
    }),

  setScene: (sceneId) => set({sceneId, selected: null, selectedLayer: null, scrollX: 0, zoomed: false}),
  select: (selected) =>
    set((s) => {
      // the first time an action is opened, its current state becomes the baseline for «what changed»
      const key = selected ? `${selected.sceneId}/${selected.actionId}` : '';
      const a = selected && s.project ? findAction(s.project, selected)?.action : undefined;
      const baselines = a && !s.baselines[key] ? {...s.baselines, [key]: structuredClone(a)} : s.baselines;
      return {selected, baselines, ...(selected ? {selectedLayer: null} : {})};
    }),
  selectLayer: (selectedLayer) => set({selectedLayer, ...(selectedLayer ? {selected: null} : {})}),

  setLayer: (sceneId, name, patch) =>
    get().edit((p) => {
      const scene = p.scenes.find((s) => s.id === sceneId);
      if (!scene) return;
      scene.layers = layersOf(scene);
      const l = scene.layers.find((x) => x.name === name);
      if (l) Object.assign(l, patch);
    }),

  moveLayer: (sceneId, name, dir) =>
    get().edit((p) => {
      const scene = p.scenes.find((s) => s.id === sceneId);
      if (!scene) return;
      scene.layers = layersOf(scene);
      const i = scene.layers.findIndex((x) => x.name === name);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= scene.layers.length) return;
      [scene.layers[i], scene.layers[j]] = [scene.layers[j], scene.layers[i]];
    }),

  scaleScene: (sceneId, k) => {
    const cur = get().project;
    if (!cur || !(k > 0) || Math.abs(k - 1) < 1e-9) return;
    const fps = cur.fps;
    const snap = (v: number) => round6(snapToFrame(v, fps));
    const minDur = 1 / fps;
    get().edit((p) => {
      for (const scene of p.scenes) {
        if (sceneId && scene.id !== sceneId) continue;
        const dur = Math.max(minDur, snap(scene.duration * k));
        for (const a of scene.actions) {
          a.start = snap(a.start * k);
          // a spring has its natural length: stretching it would change the feel
          if (a.curve.type === 'bezier') a.duration = Math.max(minDur, snap(a.duration * k));
          if (a.start + a.duration > dur) a.start = Math.max(0, snap(dur - a.duration));
        }
        scene.groups.forEach((g, i) => {
          g.from = i === 0 ? 0 : snap(g.from * k);
          g.to = i === scene.groups.length - 1 ? dur : snap(g.to * k);
        });
        for (const b of scene.backlog) b.at = Math.min(dur, snap(b.at * k));
        scene.duration = dur;
      }
    });
  },

  insertPause: (at, d) => {
    const cur = get().project;
    if (!cur || !(d > 0)) return;
    const fps = cur.fps;
    const snap = (v: number) => round6(snapToFrame(v, fps));
    const offsets = sceneOffsets(cur);
    const scene = cur.scenes.find((s) => at >= (offsets.get(s.id) ?? 0) - 1e-6 && at < (offsets.get(s.id) ?? 0) + s.duration);
    if (!scene) return;
    const local = snap(at - (offsets.get(scene.id) ?? 0));
    const dd = snap(d);
    get().edit((p) => {
      const s = p.scenes.find((x) => x.id === scene.id);
      if (!s) return;
      for (const a of s.actions) if (a.start >= local - 1e-6) a.start = snap(a.start + dd);
      for (const g of s.groups) {
        if (g.from >= local - 1e-6 && g.from > 0) g.from = snap(g.from + dd);
        if (g.to >= local - 1e-6) g.to = snap(g.to + dd);
      }
      for (const b of s.backlog) if (b.at >= local - 1e-6) b.at = snap(b.at + dd);
      s.duration = snap(s.duration + dd);
    });
  },

  setTargetSeconds: (v) =>
    get().edit((p) => {
      if (v && v > 0) p.targetSeconds = round6(v);
      else delete p.targetSeconds;
    }),
  setPlayhead: (s) => {
    const p = get().project;
    const max = p ? projectSeconds(p) : 0;
    set({playhead: Math.min(Math.max(0, s), max)});
  },
  setPlaying: (playing) => set({playing}),
  setPreviewOpen: (previewOpen) => set({previewOpen}),
  playStretch: (from, to) => set((st) => ({previewOpen: true, playhead: from, playRange: {from, to, n: (st.playRange?.n ?? 0) + 1}})),
  setAutoReplay: (autoReplay) => {
    localStorage.setItem('moootion:autoReplay', autoReplay ? '1' : '0');
    set({autoReplay});
  },
  setPanelOpen: (panelOpen) => set({panelOpen}),
  setSidebarOpen: (sidebarOpen) => set({sidebarOpen}),
  setView: (v) => set(v),

  edit: (recipe, opts = {}) => {
    const cur = get().project;
    if (!cur) return;
    const next = structuredClone(cur);
    recipe(next);
    const history = opts.history ?? true;
    set((s) => ({
      project: next,
      past: history ? [...s.past, cur].slice(-MAX_HISTORY) : s.past,
      future: history ? [] : s.future,
      save: 'dirty',
    }));
    scheduleSave();
  },

  checkpoint: () => {
    const cur = get().project;
    if (!cur) return;
    set((s) => ({past: [...s.past, cur].slice(-MAX_HISTORY), future: []}));
  },

  undo: () => {
    const {past, project, future} = get();
    if (!past.length || !project) return;
    set({project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future], save: 'dirty'});
    scheduleSave();
  },

  redo: () => {
    const {past, project, future} = get();
    if (!future.length || !project) return;
    set({project: future[0], past: [...past, project], future: future.slice(1), save: 'dirty'});
    scheduleSave();
  },

  addBacklog: (sceneId, item) =>
    get().edit((p) => {
      const scene = p.scenes.find((s) => s.id === sceneId);
      if (!scene) return;
      scene.backlog.push({
        ...item,
        id: `bl-${Date.now().toString(36)}`,
        createdAt: new Date().toISOString(),
      });
    }),

  removeBacklog: (sceneId, id) =>
    get().edit((p) => {
      const scene = p.scenes.find((s) => s.id === sceneId);
      if (scene) scene.backlog = scene.backlog.filter((b) => b.id !== id);
    }),
}));

// ── drawer heights ─────────────────────────────────────
function readDrawerHeights(): Partial<Record<PanelTab, number>> {
  const out: Partial<Record<PanelTab, number>> = {};
  for (const tab of ['chat', 'edits', 'assets'] as PanelTab[]) {
    const v = Number(localStorage.getItem(`moootion:drawerH:${tab}`));
    if (v > 0) out[tab] = v;
  }
  return out;
}
/** the drawer may rise up to the header */
const maxDrawerH = () => {
  const header = document.querySelector('.header')?.getBoundingClientRect().bottom ?? 136;
  return Math.max(240, window.innerHeight - header - 14);
};
/** chat: full height; assets: most of it (a grid of previews); edits: stop under the cards, so the thumbnails stay visible */
function defaultDrawerH(tab: PanelTab) {
  const max = maxDrawerH();
  if (tab === 'chat') return max;
  if (tab === 'assets') return Math.round(Math.max(240, max * 0.75));
  const cards = document.querySelector('.top')?.getBoundingClientRect().bottom;
  const h = cards ? window.innerHeight - cards - 10 : 520;
  return Math.round(Math.min(max, Math.max(240, h)));
}

// dev only: inspect the studio state from the browser console
if (import.meta.env.DEV) (globalThis as unknown as {__studio: typeof useStudio}).__studio = useStudio;

// ── autosave ───────────────────────────────────────────
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const scheduleSave = () => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const {project} = useStudio.getState();
    if (!project) return;
    useStudio.setState({save: 'saving'});
    try {
      await api.saveProject(project);
      // a newer edit may have happened meanwhile
      if (useStudio.getState().project === project) useStudio.setState({save: 'saved'});
    } catch {
      useStudio.setState({save: 'error'});
    }
  }, 450);
};

// ── derived helpers ────────────────────────────────────
export const projectSeconds = (p: Project) => p.scenes.reduce((sum, s) => sum + s.duration, 0);

/** start of each scene in project time */
export const sceneOffsets = (p: Project) => {
  const map = new Map<string, number>();
  let t = 0;
  for (const s of p.scenes) {
    map.set(s.id, t);
    t += s.duration;
  }
  return map;
};

export const findAction = (p: Project, sel: Selection): {scene: Scene; action: Action} | null => {
  if (!sel) return null;
  const scene = p.scenes.find((s) => s.id === sel.sceneId);
  const action = scene?.actions.find((a) => a.id === sel.actionId);
  return scene && action ? {scene, action} : null;
};

/** scenes visible in the current view and the time window they cover */
export const viewScenes = (p: Project, sceneId: string | null) => {
  const offsets = sceneOffsets(p);
  const scenes = sceneId ? p.scenes.filter((s) => s.id === sceneId) : p.scenes;
  const from = offsets.get(scenes[0].id) ?? 0;
  const to = scenes.reduce((t, s) => Math.max(t, (offsets.get(s.id) ?? 0) + s.duration), 0);
  return {scenes, offsets, from, to};
};

export const snapToFrame = (s: number, fps: number) => Math.round(s * fps) / fps;
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * The scene's layers in stacking order (bottom first). Until the user touches a
 * layer the list is derived from the actions' `layer` names in order of appearance;
 * layers that have actions but are missing from the saved list are appended.
 */
/** the project's scene code, or why it does not compile */
const tryStages = async (id: string): Promise<{stages: Stages | null; error: string | null}> => {
  try {
    return {stages: await loadStages(id), error: null};
  } catch (err) {
    return {stages: null, error: err instanceof Error ? err.message : String(err)};
  }
};

export const layersOf = (scene: Scene): SceneLayer[] => {
  const fromActions: string[] = [];
  for (const a of scene.actions) if (!fromActions.includes(a.layer)) fromActions.push(a.layer);
  const saved = scene.layers ?? [];
  const missing = fromActions.filter((n) => !saved.some((l) => l.name === n)).map((name) => ({name}));
  return [...saved.map((l) => ({...l})), ...missing];
};

function readActionPreview(): {open: boolean; size: PreviewSize} {
  try {
    const v = JSON.parse(localStorage.getItem('moootion:actionPreview') ?? 'null') as {open?: boolean; size?: PreviewSize} | null;
    return {open: v?.open ?? true, size: v?.size ?? 'S'};
  } catch {
    return {open: true, size: 'S'};
  }
}

const fmt2 = (v: number) => v.toFixed(2).replace('.', ',');
const curveText = (c: Action['curve']) =>
  c.type === 'bezier' ? `bezier(${c.v.join(', ')})` : `пружина: затухание ${c.damping}, жёсткость ${c.stiffness}`;

/** what changed in an action, in the words of the inspector: «длина 0,40 → 0,60 с» */
export const describeActionChanges = (before: Action, after: Action, fps: number): string[] => {
  const out: string[] = [];
  const eq = (x: number, y: number) => Math.abs(x - y) < 0.5 / fps;
  if (before.title !== after.title) out.push(`название «${before.title}» → «${after.title}»`);
  if (!eq(before.start, after.start)) out.push(`начало ${fmt2(before.start)} → ${fmt2(after.start)} с`);
  if (!eq(before.duration, after.duration)) out.push(`длина ${fmt2(before.duration)} → ${fmt2(after.duration)} с`);
  if (JSON.stringify(before.curve) !== JSON.stringify(after.curve)) out.push(`кривая ${curveText(before.curve)} → ${curveText(after.curve)}`);
  const keys = new Set([...Object.keys(before.params ?? {}), ...Object.keys(after.params ?? {})]);
  for (const k of keys) {
    const a = before.params?.[k];
    const b = after.params?.[k];
    if (a !== b) out.push(`${k}: ${String(a ?? '—')} → ${String(b ?? '—')}`);
  }
  return out;
};
