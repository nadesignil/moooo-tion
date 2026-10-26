import {useMemo, useRef} from 'react';
import {IconArrowDown, IconArrowUp, IconChevronDown, IconChevronRight, IconEye, IconEyeOff, IconVolume, IconVolumeOff} from '@tabler/icons-react';
import {spring} from 'remotion';
import type {Action, Curve, Scene, SceneLayer} from '../../../runtime/manifest';
import {getUsage} from '../../../runtime/timeline';
import {useAxis, useWheelZoom} from '../axis';
import {layersOf, snapToFrame, useStudio} from '../store';

type Row =
  | {kind: 'layer'; key: string; scene: Scene; layer: SceneLayer; count: number; sound: boolean; top: boolean; bottom: boolean; open: boolean}
  | {kind: 'bars'; key: string; scene: Scene; layer: string; off: number; actions: Action[]};

const SOUND = /^(video|audio)\./;

const ROW_H = 30;
const LAYER_H = 34;

/**
 * Actions on the shared time axis, by object (layer). A layer is one compact track —
 * its actions packed into as few lanes as fit; opened, it gives every action its own row.
 * The layer picked in the preview opens by itself.
 */
export const ActionRows: React.FC = () => {
  const project = useStudio((s) => s.project);
  const playhead = useStudio((s) => s.playhead);
  const selectedLayer = useStudio((s) => s.selectedLayer);
  const selected = useStudio((s) => s.selected);
  const openLayers = useStudio((s) => s.openLayers);
  const axis = useAxis();
  const wheelRef = useRef<HTMLDivElement>(null);
  // the rows scroll like a list; zoom here needs Ctrl
  useWheelZoom(wheelRef, {plain: 'scroll'});

  // open: by hand, «all», or holding the picked layer / the selected action
  const isOpen = (sceneId: string, name: string, actions: Action[]) =>
    openLayers.all ||
    Boolean(openLayers.keys[`${sceneId}/${name}`]) ||
    (selectedLayer?.sceneId === sceneId && selectedLayer.name === name) ||
    (selected?.sceneId === sceneId && actions.some((a) => a.id === selected.actionId));

  // layers in stacking order, the topmost first — like a layers panel
  const rows = useMemo<Row[]>(() => {
    if (!project || !axis.view) return [];
    const out: Row[] = [];
    for (const scene of axis.view.scenes) {
      const off = axis.view.offsets.get(scene.id) ?? 0;
      const byLayer = new Map<string, Action[]>();
      for (const a of [...scene.actions].sort((x, y) => x.start - y.start)) {
        if (!byLayer.has(a.layer)) byLayer.set(a.layer, []);
        byLayer.get(a.layer)!.push(a);
      }
      const layers = layersOf(scene);
      [...layers].reverse().forEach((layer, i) => {
        const actions = byLayer.get(layer.name) ?? [];
        out.push({
          kind: 'layer',
          key: `${scene.id}/${layer.name}`,
          scene,
          layer,
          count: actions.length,
          sound: Boolean(layer.muted) || actions.some((a) => SOUND.test(a.effect ?? '')),
          top: i === 0,
          bottom: i === layers.length - 1,
          open: isOpen(scene.id, layer.name, actions),
        });
        if (isOpen(scene.id, layer.name, actions)) {
          for (const a of actions) out.push({kind: 'bars', key: `${scene.id}/${a.id}`, scene, layer: layer.name, off, actions: [a]});
        } else {
          // pack overlapping actions into lanes
          const lanes: Action[][] = [];
          for (const a of actions) {
            const lane = lanes.find((l) => l[l.length - 1].start + l[l.length - 1].duration <= a.start + 1e-6);
            if (lane) lane.push(a);
            else lanes.push([a]);
          }
          lanes.forEach((l, i) => out.push({kind: 'bars', key: `${scene.id}/${layer.name}/${i}`, scene, layer: layer.name, off, actions: l}));
        }
      });
    }
    return out;
  }, [project, axis.view, openLayers, selectedLayer, selected]);

  if (!project) return <div className="rows" ref={wheelRef} />;
  const height = rows.reduce((h, r) => h + (r.kind === 'layer' ? LAYER_H : ROW_H), 0) + 24;
  const isSelLayer = (sceneId: string, name: string) => selectedLayer?.sceneId === sceneId && selectedLayer.name === name;

  return (
    <div className="rows scroll-y" ref={wheelRef}>
      <div style={{position: 'relative', height}}>
        {rows.map((r) =>
          r.kind === 'layer' ? (
            <LayerRow key={r.key} row={r} selected={isSelLayer(r.scene.id, r.layer.name)} />
          ) : (
            <div key={r.key} className={`row ${isSelLayer(r.scene.id, r.layer) ? 'hl' : ''}`}>
              <div className="row-guide" />
              {r.actions.map((a) => (
                <Bar key={a.id} action={a} scene={r.scene} off={r.off} />
              ))}
              {r.scene.backlog
                .filter((b) => r.actions.some((a) => a.id === b.actionId))
                .map((b) => (
                  <span key={b.id} className="seam" style={{left: axis.x(r.off + b.at)}} title={b.text || 'Шов: эффект или промпт'} />
                ))}
            </div>
          ),
        )}
        <div className="playhead thin" style={{left: axis.x(playhead)}} />
      </div>
    </div>
  );
};

/** Layer heading with the levers that need no agent: hide, mute, reorder. */
const LayerRow: React.FC<{row: Extract<Row, {kind: 'layer'}>; selected: boolean}> = ({row, selected}) => {
  const selectLayer = useStudio((s) => s.selectLayer);
  const setLayer = useStudio((s) => s.setLayer);
  const moveLayer = useStudio((s) => s.moveLayer);
  const codeLayers = useStudio((s) => s.codeLayers);
  const toggleLayerOpen = useStudio((s) => s.toggleLayerOpen);
  const {scene, layer} = row;
  // hide/mute/reorder work only when the code wraps the object in <Layer>
  const wrapped = codeLayers.includes(layer.name) || getUsage().layers.has(layer.name);
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  return (
    <div className={`row layer ${selected ? 'sel' : ''} ${layer.hidden ? 'off' : ''}`}>
      <button
        className="layer-open"
        style={{left: 30}}
        onPointerDown={stop}
        onClick={() => toggleLayerOpen(`${scene.id}/${layer.name}`)}
        title={row.open ? 'Свернуть: все действия на одной дорожке' : 'Развернуть: строка на каждое действие'}
      >
        {row.open ? <IconChevronDown size={14} stroke={1.8} /> : <IconChevronRight size={14} stroke={1.8} />}
      </button>
      <button
        className="row-layer-label"
        style={{left: 52}}
        onClick={() => selectLayer(selected ? null : {sceneId: scene.id, name: layer.name})}
        title={wrapped ? 'Слой: клик — подсветить его действия' : 'Код не оборачивает этот объект в <Layer> — скрыть и переставить его нельзя'}
      >
        {layer.name} · {row.count}
        {!wrapped ? <span className="layer-nowrap">без слоя</span> : null}
      </button>
      <div className="layer-tools" onPointerDown={stop}>
        <button
          className={layer.hidden ? 'on' : ''}
          disabled={!wrapped}
          title={layer.hidden ? 'Показать слой' : 'Скрыть слой'}
          onClick={() => setLayer(scene.id, layer.name, {hidden: !layer.hidden})}
        >
          {layer.hidden ? <IconEyeOff size={15} stroke={1.5} /> : <IconEye size={15} stroke={1.5} />}
        </button>
        {row.sound ? (
          <button
            className={layer.muted ? 'on' : ''}
            disabled={!wrapped}
            title={layer.muted ? 'Включить звук слоя' : 'Выключить звук слоя'}
            onClick={() => setLayer(scene.id, layer.name, {muted: !layer.muted})}
          >
            {layer.muted ? <IconVolumeOff size={15} stroke={1.5} /> : <IconVolume size={15} stroke={1.5} />}
          </button>
        ) : null}
        <button disabled={!wrapped || row.top} title="Слой выше (ближе к зрителю)" onClick={() => moveLayer(scene.id, layer.name, 1)}>
          <IconArrowUp size={15} stroke={1.5} />
        </button>
        <button disabled={!wrapped || row.bottom} title="Слой ниже" onClick={() => moveLayer(scene.id, layer.name, -1)}>
          <IconArrowDown size={15} stroke={1.5} />
        </button>
      </div>
    </div>
  );
};

const Bar: React.FC<{action: Action; scene: Scene; off: number}> = ({action, scene, off}) => {
  const axis = useAxis();
  const selected = useStudio((s) => s.selected);
  const select = useStudio((s) => s.select);
  const edit = useStudio((s) => s.edit);
  const checkpoint = useStudio((s) => s.checkpoint);
  const fps = useStudio((s) => s.project?.fps ?? 60);
  const playhead = useStudio((s) => s.playhead);
  const ref = useRef<HTMLDivElement>(null);

  const left = axis.x(off + action.start);
  const width = Math.max(4, action.duration * axis.pps);
  const isSel = selected?.sceneId === scene.id && selected.actionId === action.id;
  const usage = getUsage();
  const unused = usage.used.size > 0 && !usage.used.has(action.id);
  const narrow = width < action.title.length * 7 + 20;

  const drag = (e: React.PointerEvent, mode: 'move' | 'l' | 'r') => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const orig = {start: action.start, duration: action.duration};
    let moved = false;
    // magnet targets: other actions' edges, subscene bounds, playhead
    const targets = [
      0,
      scene.duration,
      playhead - off,
      ...scene.groups.flatMap((g) => [g.from, g.to]),
      ...scene.actions.filter((a) => a.id !== action.id).flatMap((a) => [a.start, a.start + a.duration]),
    ];
    const magnet = (v: number, alt: boolean) => {
      if (alt) return v;
      let best = v;
      let bestD = 7 / axis.pps;
      for (const t of targets) {
        const d = Math.abs(t - v);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
      return best;
    };
    const move = (ev: PointerEvent) => {
      const dt = (ev.clientX - startX) / axis.pps;
      if (!moved && Math.abs(ev.clientX - startX) < 3) return;
      if (!moved) {
        moved = true;
        checkpoint();
      }
      const minDur = 1 / fps;
      let start = orig.start;
      let dur = orig.duration;
      if (mode === 'move') {
        start = orig.start + dt;
        const snapA = magnet(start, ev.altKey);
        const snapB = magnet(start + dur, ev.altKey) - dur;
        start = Math.abs(snapA - start) <= Math.abs(snapB - start) ? snapA : snapB;
        start = Math.min(Math.max(0, start), scene.duration - dur);
      } else if (mode === 'l') {
        const end = orig.start + orig.duration;
        start = Math.min(end - minDur, Math.max(0, magnet(orig.start + dt, ev.altKey)));
        dur = end - start;
      } else {
        const end = Math.min(scene.duration, Math.max(orig.start + minDur, magnet(orig.start + orig.duration + dt, ev.altKey)));
        dur = end - start;
      }
      start = snapToFrame(start, fps);
      dur = Math.max(minDur, snapToFrame(dur, fps));
      edit(
        (p) => {
          const a = p.scenes.find((s) => s.id === scene.id)?.actions.find((x) => x.id === action.id);
          if (a) {
            a.start = round6(start);
            a.duration = round6(dur);
          }
        },
        {history: false},
      );
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) select({sceneId: scene.id, actionId: action.id});
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      ref={ref}
      className={`bar ${action.curve.type === 'spring' ? 'spring' : ''} ${isSel ? 'selected' : ''} ${unused ? 'unused' : ''} ${narrow ? 'narrow' : ''}`}
      style={{left, width}}
      onPointerDown={(e) => drag(e, 'move')}
      title={`${action.title}${unused ? ' — код не читает это действие' : ''}`}
    >
      {width > 26 ? <CurveSpark curve={action.curve} width={width} /> : null}
      <span className="bar-label">{action.title}</span>
      <span className="bar-edge l" onPointerDown={(e) => drag(e, 'l')} />
      <span className="bar-edge r" onPointerDown={(e) => drag(e, 'r')} />
    </div>
  );
};

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** tiny drawing of the curve shape inside the bar */
export const curveSamples = (curve: Curve, n = 32) => {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let v: number;
    if (curve.type === 'bezier') {
      v = cubic(curve.v, t);
    } else {
      v = spring({
        frame: t * 60,
        fps: 60,
        config: {damping: curve.damping, stiffness: curve.stiffness, mass: curve.mass ?? 1},
        durationInFrames: 60,
      });
    }
    pts.push([t, v]);
  }
  return pts;
};

const CurveSpark: React.FC<{curve: Curve; width: number}> = ({curve, width}) => {
  const pts = curveSamples(curve, 24);
  const d = pts.map(([t, v], i) => `${i ? 'L' : 'M'}${(t * width).toFixed(1)},${(14 - v * 12).toFixed(1)}`).join(' ');
  return (
    <svg className="bar-curve" width={width} height={16} viewBox={`0 0 ${width} 16`} preserveAspectRatio="none">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

/** cubic-bezier evaluation (x→y) for drawing */
export const cubic = ([x1, y1, x2, y2]: [number, number, number, number], x: number) => {
  // solve bezier x(t)=x by Newton, then return y(t)
  let t = x;
  for (let i = 0; i < 8; i++) {
    const cx = 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t ** 2 * (1 - t) + t ** 3 - x;
    const dx = 3 * x1 * (1 - t) ** 2 + 6 * (x2 - x1) * t * (1 - t) + 3 * (1 - x2) * t ** 2;
    if (Math.abs(dx) < 1e-6) break;
    t = Math.min(1, Math.max(0, t - cx / dx));
  }
  return 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t ** 2 * (1 - t) + t ** 3;
};
