import {createContext, useContext, useMemo} from 'react';
import {AbsoluteFill, Audio, Easing, Sequence, getRemotionEnvironment, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Action, Project, Scene} from './manifest';
import {isVariants, sceneFrames} from './manifest';

// ───────────────────────── evaluation ─────────────────────────

export type ActionState = {
  id: string;
  /** eased progress (springs may overshoot 1) */
  p: number;
  /** linear progress 0..1 */
  lin: number;
  /** first / last frame of the action (scene-local) */
  f0: number;
  f1: number;
  started: boolean;
  done: boolean;
  params: Record<string, number | string | boolean>;
  /** the action's curve as a function of 0..1 — for staggered sub-parts and envelopes */
  ease: (t: number) => number;
  missing: boolean;
};

const easings = new Map<string, (t: number) => number>();
const bezier = (v: [number, number, number, number]) => {
  const key = v.join(',');
  let fn = easings.get(key);
  if (!fn) {
    fn = Easing.bezier(...v);
    easings.set(key, fn);
  }
  return fn;
};

const MISSING = (id: string): ActionState => ({
  id,
  p: 0,
  lin: 0,
  f0: 0,
  f1: 1,
  started: false,
  done: false,
  params: {},
  ease: (t) => t,
  missing: true,
});

export const evalAction = (a: Action | undefined, id: string, frame: number, fps: number): ActionState => {
  if (!a) return MISSING(id);
  const f0 = Math.round(a.start * fps);
  const f1 = Math.max(f0 + 1, Math.round((a.start + a.duration) * fps));
  const lin = Math.min(1, Math.max(0, (frame - f0) / (f1 - f0)));
  let p: number;
  if (a.curve.type === 'bezier') {
    p = bezier(a.curve.v)(lin);
  } else {
    p = spring({
      frame: frame - f0,
      fps,
      config: {
        damping: a.curve.damping,
        stiffness: a.curve.stiffness,
        mass: a.curve.mass ?? 1,
      },
      durationInFrames: f1 - f0,
    });
  }
  const curve = a.curve;
  return {
    id,
    p,
    lin,
    f0,
    f1,
    started: frame >= f0,
    done: frame >= f1,
    params: a.params ?? {},
    // a spring as a function of 0..1, so staggered parts and envelopes follow it too
    ease:
      curve.type === 'bezier'
        ? bezier(curve.v)
        : (t) =>
            spring({
              frame: t * (f1 - f0),
              fps,
              config: {
                damping: curve.damping,
                stiffness: curve.stiffness,
                mass: curve.mass ?? 1,
              },
              durationInFrames: f1 - f0,
            }),
    missing: false,
  };
};

// ───────────────────────── usage registry ─────────────────────────
// The studio reads which action ids the code actually uses: an action that
// no code reads is shown as "not connected", and an action whose curve the code
// never reads (it takes only the timing and params) gets its curve editor muted.
type Registry = {
  used: Set<string>;
  missing: Set<string>;
  layers: Set<string>;
  /** the code read the action's curve (p or ease) */
  curve: Set<string>;
  /** the code evaluated the action inside its own time range — only then is "curve unused" a verdict */
  active: Set<string>;
};
const registry = (): Registry => {
  const g = globalThis as unknown as {__moootionUsage?: Registry};
  if (!g.__moootionUsage)
    g.__moootionUsage = {
      used: new Set(),
      missing: new Set(),
      layers: new Set(),
      curve: new Set(),
      active: new Set(),
    };
  const r = g.__moootionUsage;
  r.layers ??= new Set();
  r.curve ??= new Set();
  r.active ??= new Set();
  return r;
};
export const getUsage = () => registry();

/** the state with `p` and `ease` reporting that the code reads the curve */
const trackCurve = (st: ActionState, reg: Registry): ActionState => {
  if (st.missing) return st;
  const out = {...st};
  Object.defineProperty(out, 'p', {
    enumerable: true,
    get: () => {
      reg.curve.add(st.id);
      return st.p;
    },
  });
  Object.defineProperty(out, 'ease', {
    enumerable: true,
    get: () => {
      reg.curve.add(st.id);
      return st.ease;
    },
  });
  return out;
};

// ───────────────────────── context & hooks ─────────────────────────

type SceneCtx = {scene: Scene; byId: Map<string, Action>};
const Ctx = createContext<SceneCtx | null>(null);

export const SceneProvider: React.FC<{
  scene: Scene;
  children: React.ReactNode;
}> = ({scene, children}) => {
  const value = useMemo(() => ({scene, byId: new Map(scene.actions.map((a) => [a.id, a]))}), [scene]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

/**
 * Timeline accessor for the current scene. `at(id)` evaluates an action at the
 * current frame, `at(id, f)` at any scene frame (for velocity, look-ahead…).
 */
export const useTimeline = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTimeline() must be used inside <SceneProvider>');
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const reg = registry();
  const at = (id: string, f: number = frame) => {
    const a = ctx.byId.get(id);
    if (a) reg.used.add(id);
    else reg.missing.add(id);
    const st = evalAction(a, id, f, fps);
    if (a && f >= st.f0 && f < st.f1) reg.active.add(id);
    return trackCurve(st, reg);
  };
  return {at, frame, fps, scene: ctx.scene};
};

export const useAction = (id: string) => useTimeline().at(id);

// ───────────────────────── layers ─────────────────────────
// Every visual object is wrapped in <Layer name>. The studio finds the layer under
// a click in the preview, hides it, mutes it or reorders it through scene.layers —
// no agent run needed. Projects written before layers existed simply have none.

export type LayerState = {
  name: string;
  hidden: boolean;
  muted: boolean;
  z: number | undefined;
};
const LayerCtx = createContext<LayerState | null>(null);
const NO_LAYER: LayerState = {
  name: '',
  hidden: false,
  muted: false,
  z: undefined,
};

const useLayerState = (name: string): LayerState => {
  const ctx = useContext(Ctx);
  // the render imports project.json without zod, so `layers` may be absent
  const layers = ctx?.scene.layers ?? [];
  const i = layers.findIndex((l) => l.name === name);
  const l = i >= 0 ? layers[i] : undefined;
  return {
    name,
    hidden: Boolean(l?.hidden),
    muted: Boolean(l?.muted),
    z: i >= 0 ? i + 1 : undefined,
  };
};

/** The layer the current element sits in — `<Video muted={useLayer().muted}>`. */
export const useLayer = () => useContext(LayerCtx) ?? NO_LAYER;

export const Layer: React.FC<{
  name: string;
  style?: React.CSSProperties;
  className?: string;
  children: React.ReactNode;
}> = ({name, style, className, children}) => {
  const st = useLayerState(name);
  // the studio greys out hide/mute for layers the code does not wrap
  registry().layers.add(name);
  if (st.hidden) return null;
  return (
    <LayerCtx.Provider value={st}>
      <AbsoluteFill data-moootion-layer={name} className={className} style={{zIndex: st.z, ...style}}>
        {children}
      </AbsoluteFill>
    </LayerCtx.Provider>
  );
};

// ───────────────────────── assets ─────────────────────────
// In a Remotion render assets come from the bundle (staticFile). Inside the
// studio Player they are served by the studio server per project.
export const asset = (path: string) => {
  const base = (globalThis as unknown as {__MOOOTION_ASSET_BASE__?: string}).__MOOOTION_ASSET_BASE__;
  if (base && getRemotionEnvironment().isPlayer) return base + path;
  return staticFile(path);
};

// ───────────────────────── project video ─────────────────────────

export type Stages = Record<string, React.FC>;

const ProjectCtx = createContext<Project | null>(null);
/** the whole manifest (template settings, background) for code inside a scene */
export const useProject = () => useContext(ProjectCtx);

export const ProjectVideo: React.FC<{project: Project; stages: Stages}> = ({project, stages}) => {
  let from = 0;
  // the render imports project.json without zod: settings may be absent
  const music = project.settings?.music;
  // variants are separate videos: the music starts over in each one
  const perScene = isVariants(project);
  const track = music?.file ? (
    <Audio src={asset(music.file)} volume={music.gain ?? 1} startFrom={Math.round((music.from ?? 0) * project.fps)} />
  ) : null;
  return (
    <ProjectCtx.Provider value={project}>
      <AbsoluteFill style={{background: '#000'}}>
        {project.scenes.map((scene) => {
          const Stage = stages[scene.id];
          const dur = sceneFrames(scene, project.fps);
          const seq = (
            <Sequence key={scene.id} from={from} durationInFrames={dur} name={scene.title}>
              <SceneProvider scene={scene}>
                <AbsoluteFill data-moootion-scene={scene.id}>{Stage ? <Stage /> : <MissingStage id={scene.id} />}</AbsoluteFill>
              </SceneProvider>
              {perScene ? track : null}
            </Sequence>
          );
          from += dur;
          return seq;
        })}
        {/* «Настройки проекта» → музыка: one track under all scenes */}
        {perScene ? null : track}
      </AbsoluteFill>
    </ProjectCtx.Provider>
  );
};

const MissingStage: React.FC<{id: string}> = ({id}) => (
  <AbsoluteFill
    style={{
      alignItems: 'center',
      justifyContent: 'center',
      color: '#fff',
      fontSize: 40,
    }}
  >
    Нет кода сцены «{id}»
  </AbsoluteFill>
);
