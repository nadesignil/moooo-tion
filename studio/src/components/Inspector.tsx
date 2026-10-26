import {useEffect, useRef, useState} from 'react';
import {IconArrowBackUp, IconArrowDown, IconArrowUp, IconEye, IconEyeOff, IconLink, IconLinkOff, IconMovie, IconVolume, IconVolumeOff, IconX} from '@tabler/icons-react';
import {CURVE_PRESETS, type Action, type Curve} from '../../../runtime/manifest';
import {getUsage} from '../../../runtime/timeline';
import {alternatives, effectName, EFFECTS} from '../catalog';
import {describeActionChanges, findAction, layersOf, snapToFrame, useStudio, type LayerSelection} from '../store';
import {plural, sec2} from '../format';
import {curveSamples} from './ActionRows';
import {Checkbox} from './Checkbox';

/**
 * Parameters of the selected action (or the selected layer). Edits apply to the preview
 * at once; «Сохранить изменения» records them as a version, the ↶ next to a field puts
 * it back to how it was when the action was opened (or last saved).
 */
export const Inspector: React.FC<{onToast?: (t: string) => void}> = ({onToast}) => {
  const project = useStudio((s) => s.project);
  const selected = useStudio((s) => s.selected);
  const selectedLayer = useStudio((s) => s.selectedLayer);
  const select = useStudio((s) => s.select);
  const edit = useStudio((s) => s.edit);
  const addBacklog = useStudio((s) => s.addBacklog);
  const baselines = useStudio((s) => s.baselines);
  const resetAction = useStudio((s) => s.resetAction);
  const saveAction = useStudio((s) => s.saveAction);
  const actionPreview = useStudio((s) => s.actionPreview);
  const setActionPreview = useStudio((s) => s.setActionPreview);
  const [saving, setSaving] = useState(false);
  const selEffect = project ? findAction(project, selected)?.action.effect : undefined;
  // playback (music, video) has no easing to speak of: no warning there
  const curveUnused = useCurveUnused(selected?.actionId) && !/^(audio|video)\./.test(selEffect ?? '');
  if (!project) return null;
  const found = findAction(project, selected);
  if (!found) return selectedLayer ? <LayerPanel sel={selectedLayer} /> : null;
  const {scene, action} = found;
  const fps = project.fps;

  const change = (recipe: (a: Action) => void, history = true) =>
    edit((p) => {
      const a = p.scenes.find((s) => s.id === scene.id)?.actions.find((x) => x.id === action.id);
      if (a) recipe(a);
    }, {history});

  const used = getUsage().used.has(action.id);
  const toBacklog = (text: string, kind: 'prompt' | 'effect') => {
    addBacklog(scene.id, {kind, at: action.start, actionId: action.id, text});
  };

  // what differs from the baseline, field by field
  const base = baselines[`${scene.id}/${action.id}`];
  const eq = (x: number, y: number) => Math.abs(x - y) < 0.5 / fps;
  const changed = {
    start: Boolean(base && !eq(base.start, action.start)),
    duration: Boolean(base && !eq(base.duration, action.duration)),
    title: Boolean(base && base.title !== action.title),
    curve: Boolean(base && JSON.stringify(base.curve) !== JSON.stringify(action.curve)),
    param: (k: string) => Boolean(base && base.params?.[k] !== action.params?.[k]),
  };
  const changes = base ? describeActionChanges(base, action, fps) : [];
  const reset = (field?: string) => () => resetAction(scene.id, action.id, field);

  const save = async () => {
    setSaving(true);
    try {
      await saveAction(scene.id, action.id);
      onToast?.(`Сохранено в «Версиях»: ${changes.length} ${plural(changes.length, 'изменение', 'изменения', 'изменений')}`);
    } catch (e) {
      onToast?.(`Не удалось сохранить: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="inspector" onPointerDown={(e) => e.stopPropagation()}>
      <div className="insp-head">
        <div style={{flex: 1, minWidth: 0}}>
          <div className="insp-title-row">
            <input value={action.title} onChange={(e) => change((a) => (a.title = e.target.value))} />
            {changed.title ? <ResetBtn onClick={reset('title')} /> : null}
          </div>
          <small>
            {action.layer} · {effectName(action.effect)}
          </small>
        </div>
        {!actionPreview.open ? (
          <button className="icon-btn" onClick={() => setActionPreview({open: true})} title="Показать превью действия">
            <IconMovie size={17} stroke={1.5} />
          </button>
        ) : null}
        <button className="icon-btn" onClick={() => select(null)} title="Закрыть (Esc)">
          <IconX size={17} stroke={1.5} />
        </button>
      </div>
      <div className="insp-body scroll-y">
        <div className={`link-status ${used ? 'ok' : 'warn'}`}>
          {used ? <IconLink size={15} /> : <IconLinkOff size={15} />}
          {used ? 'Код читает это действие — правки видны сразу' : 'Код не читает это действие — правка ни на что не повлияет'}
        </div>

        <section className="insp-section">
          <h4>Время</h4>
          <div className="field-grid">
            <NumField
              label="Начало, с"
              value={action.start}
              step={1 / fps}
              onReset={changed.start ? reset('start') : undefined}
              onChange={(v, h) => change((a) => (a.start = clampStart(v, a, scene.duration, fps)), h)}
            />
            <NumField
              label="Длина, с"
              value={action.duration}
              step={1 / fps}
              onReset={changed.duration ? reset('duration') : undefined}
              onChange={(v, h) => change((a) => (a.duration = clampDur(v, a, scene.duration, fps)), h)}
            />
          </div>
          <div className="quick">
            <button className="preset" onClick={() => change((a) => (a.duration = clampDur(a.duration / 2, a, scene.duration, fps)))} title="Длительность вдвое меньше">
              быстрее ×2
            </button>
            <button className="preset" onClick={() => change((a) => (a.duration = clampDur(a.duration * 2, a, scene.duration, fps)))} title="Длительность вдвое больше">
              медленнее ×2
            </button>
            <button className="preset" onClick={() => change((a) => (a.start = clampStart(a.start + 0.5, a, scene.duration, fps)))} title="Начать на полсекунды позже">
              позже +0,5
            </button>
            <button className="preset" onClick={() => change((a) => (a.start = clampStart(a.start - 0.5, a, scene.duration, fps)))} title="Начать на полсекунды раньше">
              раньше −0,5
            </button>
          </div>
        </section>

        <section className={`insp-section ${curveUnused ? 'muted' : ''}`}>
          <h4>
            <span className="h4-main">
              Кривая {changed.curve ? <ResetBtn onClick={reset('curve')} /> : null}
            </span>
            {curveUnused ? <em className="queued">код её не читает</em> : null}
          </h4>
          {curveUnused ? (
            <div className="curve-note">
              Код этого действия берёт из манифеста только время и параметры, поэтому изменения кривой в ролике не видны.
              <button
                className="msg-btn"
                onClick={() =>
                  toBacklog(`Подключить кривую действия «${action.title}» (${action.id}): прогресс и огибающая — из a.p / a.ease`, 'prompt')
                }
              >
                в правки: подключить кривую
              </button>
            </div>
          ) : null}
          <CurveEditor curve={action.curve} onChange={(c, h) => change((a) => (a.curve = c), h)} />
        </section>

        {action.params && Object.keys(action.params).length ? (
          <section className="insp-section">
            <h4>Параметры</h4>
            <div className="field-grid">
              {Object.entries(action.params).map(([k, v]) => {
                const onReset = changed.param(k) ? reset(`params.${k}`) : undefined;
                return typeof v === 'number' ? (
                  <NumField key={k} label={paramName(k)} value={v} step={stepFor(k, v, fps)} onReset={onReset} onChange={(nv, h) => change((a) => (a.params![k] = round6(nv)), h)} />
                ) : typeof v === 'boolean' ? (
                  <label key={k} className="field">
                    <FieldLabel label={paramName(k)} onReset={onReset} />
                    <Checkbox checked={v} onChange={(nv) => change((a) => (a.params![k] = nv))} />
                  </label>
                ) : /^#[0-9a-f]{6}$/i.test(v) ? (
                  <div key={k} className="field">
                    <FieldLabel label={paramName(k)} onReset={onReset} />
                    <input type="color" value={v} onChange={(e) => change((a) => (a.params![k] = e.target.value), false)} />
                  </div>
                ) : (
                  <div key={k} className="field" style={{gridColumn: '1 / -1'}}>
                    <FieldLabel label={paramName(k)} onReset={onReset} />
                    <input type="text" value={v} onChange={(e) => change((a) => (a.params![k] = e.target.value))} />
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        <section className="insp-section">
          <h4>
            Заменить на <em className="queued">через агента</em>
          </h4>
          {alternatives(action.effect, action.variants)
            .slice(0, 6)
            .map((id) => (
              <button key={id} className="variant" onClick={() => toBacklog(`Заменить «${action.title}» на «${effectName(id)}» (${id})`, 'effect')}>
                <span>
                  {effectName(id)} <span style={{opacity: 0.4}}>· {EFFECTS[id]?.hint ?? ''}</span>
                </span>
                <small>в правки</small>
              </button>
            ))}
        </section>
      </div>

      <div className="insp-foot">
        {changes.length ? (
          <div className="insp-changes">
            Изменено: {changes.length} · <button className="msg-btn" onClick={reset()}>сбросить всё</button>
          </div>
        ) : null}
        <div className="insp-actions">
          <button className="pill solid" disabled={!changes.length || saving} onClick={save} title={changes.length ? changes.join('\n') : 'Изменений нет'}>
            {saving ? 'Сохраняю…' : 'Сохранить изменения'}
          </button>
          <button
            className="pill"
            onClick={() => {
              // the text is typed in «Правки», the one place for notes to the agent
              toBacklog('', 'prompt');
              const st = useStudio.getState();
              const id = st.project?.scenes.find((s) => s.id === scene.id)?.backlog.at(-1)?.id;
              if (id) st.openEdit(scene.id, id);
            }}
            title="Добавить правку для агента, привязанную к этому действию"
          >
            Правка к действию…
          </button>
        </div>
      </div>
    </div>
  );
};

/** «put it back» — next to a value that differs from its baseline */
const ResetBtn: React.FC<{onClick: () => void}> = ({onClick}) => (
  <button
    className="reset-btn"
    onPointerDown={(e) => e.stopPropagation()}
    onClick={(e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    }}
    title="Вернуть как было"
  >
    <IconArrowBackUp size={13} stroke={1.8} />
  </button>
);

const FieldLabel: React.FC<{label: string; onReset?: () => void; onPointerDown?: (e: React.PointerEvent) => void}> = ({label, onReset, onPointerDown}) => (
  <span className="field-label">
    <label onPointerDown={onPointerDown} title={onPointerDown ? 'Перетащите влево/вправо' : undefined}>
      {label}
    </label>
    {onReset ? <ResetBtn onClick={onReset} /> : null}
  </span>
);

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * Does the code ignore this action's curve? Known only after the code evaluated the
 * action inside its own time range (the segment preview plays it), so it is polled.
 */
const useCurveUnused = (actionId: string | undefined) => {
  const [unused, setUnused] = useState(false);
  useEffect(() => {
    if (!actionId) return;
    const check = () => {
      const u = getUsage();
      setUnused(u.active.has(actionId) && !u.curve.has(actionId));
    };
    check();
    const t = setInterval(check, 600);
    return () => clearInterval(t);
  }, [actionId]);
  return unused;
};

/** The selected layer: visibility, sound, stacking order and the list of its actions. */
const LayerPanel: React.FC<{sel: NonNullable<LayerSelection>}> = ({sel}) => {
  const project = useStudio((s) => s.project);
  const selectLayer = useStudio((s) => s.selectLayer);
  const select = useStudio((s) => s.select);
  const setLayer = useStudio((s) => s.setLayer);
  const moveLayer = useStudio((s) => s.moveLayer);
  const codeLayers = useStudio((s) => s.codeLayers);
  const scene = project?.scenes.find((s) => s.id === sel.sceneId);
  if (!project || !scene) return null;
  const layers = layersOf(scene);
  const idx = layers.findIndex((l) => l.name === sel.name);
  const layer = layers[idx] ?? {name: sel.name};
  const wrapped = codeLayers.includes(sel.name) || getUsage().layers.has(sel.name);
  const actions = scene.actions.filter((a) => a.layer === sel.name).sort((a, b) => a.start - b.start);

  return (
    <div className="inspector" onPointerDown={(e) => e.stopPropagation()}>
      <div className="insp-head">
        <div style={{flex: 1, minWidth: 0}}>
          <div className="insp-title">{sel.name}</div>
          <small>
            слой · {scene.title} · {actions.length} {plural(actions.length, 'действие', 'действия', 'действий')}
          </small>
        </div>
        <button className="icon-btn" onClick={() => selectLayer(null)} title="Закрыть (Esc)">
          <IconX size={17} stroke={1.5} />
        </button>
      </div>
      <div className="insp-body scroll-y">
        <div className={`link-status ${wrapped ? 'ok' : 'warn'}`}>
          {wrapped ? <IconLink size={15} /> : <IconLinkOff size={15} />}
          {wrapped
            ? 'Код оборачивает объект в <Layer> — слой можно скрыть, заглушить и переставить'
            : 'Код не оборачивает объект в <Layer> — напишите агенту: «оберни объекты сцены в <Layer>»'}
        </div>

        <section className="insp-section">
          <h4>
            Слой <em>сразу в превью</em>
          </h4>
          <div className="quick">
            <button className={`preset ${layer.hidden ? 'on' : ''}`} disabled={!wrapped} onClick={() => setLayer(scene.id, sel.name, {hidden: !layer.hidden})}>
              {layer.hidden ? <IconEyeOff size={13} /> : <IconEye size={13} />} {layer.hidden ? 'скрыт' : 'виден'}
            </button>
            <button className={`preset ${layer.muted ? 'on' : ''}`} disabled={!wrapped} onClick={() => setLayer(scene.id, sel.name, {muted: !layer.muted})}>
              {layer.muted ? <IconVolumeOff size={13} /> : <IconVolume size={13} />} {layer.muted ? 'без звука' : 'со звуком'}
            </button>
            <button className="preset" disabled={!wrapped || idx < 0 || idx >= layers.length - 1} onClick={() => moveLayer(scene.id, sel.name, 1)}>
              <IconArrowUp size={13} /> выше
            </button>
            <button className="preset" disabled={!wrapped || idx <= 0} onClick={() => moveLayer(scene.id, sel.name, -1)}>
              <IconArrowDown size={13} /> ниже
            </button>
          </div>
          <p className="insp-hint" style={{marginTop: 8}}>
            {idx >= 0 ? `Порядок наложения: ${layers.length - idx} из ${layers.length} сверху.` : 'Слой без действий.'} Выше — ближе к зрителю.
          </p>
        </section>

        <section className="insp-section">
          <h4>Действия слоя</h4>
          {actions.map((a) => (
            <button key={a.id} className="variant" onClick={() => select({sceneId: scene.id, actionId: a.id})}>
              <span>
                {a.title} <span style={{opacity: 0.4}}>· {effectName(a.effect)}</span>
              </span>
              <small style={{color: 'inherit', opacity: 0.5}}>{sec2(a.start)} с</small>
            </button>
          ))}
          {!actions.length ? <div className="empty">У этого слоя нет действий в манифесте.</div> : null}
        </section>
      </div>
    </div>
  );
};

const PARAM_NAMES: Record<string, string> = {
  from: 'от',
  to: 'до',
  fromX: 'старт X, px',
  fromY: 'старт Y, px',
  toY: 'финиш Y, px',
  fromW: 'старт ширина, px',
  toW: 'финиш ширина, px',
  fromTop: 'старт верх, px',
  toTop: 'финиш верх, px',
  dx: 'сдвиг X, px',
  dy: 'сдвиг Y, px',
  dist: 'дистанция, px',
  distance: 'дистанция, px',
  tilt: 'наклон, °',
  rot: 'поворот, °',
  scaleFrom: 'масштаб от',
  scaleTo: 'масштаб до',
  shrink: 'сжатие',
  depth: 'глубина нажатия',
  ink: 'цвет',
  speed: 'скорость',
  amp: 'амплитуда, px',
  freq: 'частота, Гц',
  rotFreq: 'частота поворота',
  rampIn: 'нарастание, с',
  rampOut: 'затухание, с',
  stagger: 'шаг волны, с',
  staggerLeft: 'задержка слева, с',
  staggerRight: 'задержка справа, с',
  each: 'длина элемента, с',
  text: 'текст',
  size: 'размер, px',
  visible: 'показывать',
  phoneWidthFrom: 'ширина телефона от',
  phoneWidthTo: 'ширина телефона до',
};
const paramName = (k: string) => PARAM_NAMES[k] ?? k;
const clampStart = (v: number, a: Action, sceneDur: number, fps: number) =>
  round6(snapToFrame(Math.min(Math.max(0, v), sceneDur - a.duration), fps));
const clampDur = (v: number, a: Action, sceneDur: number, fps: number) =>
  round6(Math.max(1 / fps, snapToFrame(Math.min(v, sceneDur - a.start), fps)));
const stepFor = (key: string, v: number, fps: number) => {
  if (/stagger|each|ramp/i.test(key)) return 1 / fps;
  const m = Math.abs(v);
  return m < 2 ? 0.01 : m < 30 ? 0.5 : 1;
};

/** Number input; drag the label left/right to scrub the value. */
const NumField: React.FC<{
  label: string;
  value: number;
  step: number;
  onChange: (v: number, history: boolean) => void;
  onReset?: () => void;
}> = ({label, value, step, onChange, onReset}) => {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? fmt(value, step);
  const scrub = (e: React.PointerEvent) => {
    const x0 = e.clientX;
    const v0 = value;
    let first = true;
    const move = (ev: PointerEvent) => {
      const k = ev.shiftKey ? 10 : 1;
      onChange(v0 + Math.round((ev.clientX - x0) / 4) * step * k, first);
      first = false;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className="field">
      <FieldLabel label={label} onReset={onReset} onPointerDown={scrub} />
      <input
        value={shown}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = parseFloat((text ?? '').replace(',', '.'));
          if (!Number.isNaN(v)) onChange(v, true);
          setText(null);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
};

const fmt = (v: number, step: number) => {
  const digits = step < 0.01 ? 3 : step < 0.1 ? 2 : step < 1 ? 1 : 0;
  return v.toFixed(digits).replace('.', ',');
};

// ── curve editor ────────────────────────────────────────
const W = 300;
const H = 120;
const PAD = 14;

const CurveEditor: React.FC<{curve: Curve; onChange: (c: Curve, history: boolean) => void}> = ({curve, onChange}) => {
  const ref = useRef<SVGSVGElement>(null);
  const pts = curveSamples(curve, 48);
  const vs = pts.map(([, v]) => v);
  const lo = Math.min(0, ...vs);
  const hi = Math.max(1, ...vs, curve.type === 'bezier' ? Math.max(curve.v[1], curve.v[3]) : 1);
  const X = (t: number) => PAD + t * (W - PAD * 2);
  const Y = (v: number) => H - PAD - ((v - lo) / (hi - lo)) * (H - PAD * 2);
  const path = pts.map(([t, v], i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');

  const dragHandle = (idx: 0 | 1) => (e: React.PointerEvent) => {
    if (curve.type !== 'bezier') return;
    const rect = ref.current!.getBoundingClientRect();
    let first = true;
    const move = (ev: PointerEvent) => {
      const x = Math.min(1, Math.max(0, (ev.clientX - rect.left - PAD) / (W - PAD * 2)));
      const y = lo + ((H - PAD - (ev.clientY - rect.top)) / (H - PAD * 2)) * (hi - lo);
      const v = [...curve.v] as [number, number, number, number];
      v[idx * 2] = Math.round(x * 100) / 100;
      v[idx * 2 + 1] = Math.round(Math.min(2, Math.max(-1, y)) * 100) / 100;
      onChange({type: 'bezier', v}, first);
      first = false;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const presetName = Object.entries(CURVE_PRESETS).find(([, c]) => JSON.stringify(c) === JSON.stringify(curve))?.[0];

  return (
    <div className="curve-box">
      <svg ref={ref} width="100%" viewBox={`0 0 ${W} ${H}`} style={{display: 'block'}}>
        <line x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(0)} stroke="rgba(255,255,255,.1)" />
        <line x1={X(0)} y1={Y(1)} x2={X(1)} y2={Y(1)} stroke="rgba(255,255,255,.1)" strokeDasharray="3 3" />
        {curve.type === 'bezier' ? (
          <>
            <line x1={X(0)} y1={Y(0)} x2={X(curve.v[0])} y2={Y(curve.v[1])} stroke="rgba(180,219,71,.5)" />
            <line x1={X(1)} y1={Y(1)} x2={X(curve.v[2])} y2={Y(curve.v[3])} stroke="rgba(180,219,71,.5)" />
          </>
        ) : null}
        <path d={path} fill="none" stroke="#fff" strokeWidth={2} />
        {curve.type === 'bezier' ? (
          <>
            <circle cx={X(curve.v[0])} cy={Y(curve.v[1])} r={6} fill="#b4db47" style={{cursor: 'grab'}} onPointerDown={dragHandle(0)} />
            <circle cx={X(curve.v[2])} cy={Y(curve.v[3])} r={6} fill="#b4db47" style={{cursor: 'grab'}} onPointerDown={dragHandle(1)} />
          </>
        ) : null}
      </svg>
      {curve.type === 'spring' ? (
        <>
          <div className="quick" style={{marginTop: 8}}>
            <button className="preset" onClick={() => onChange({...curve, damping: curve.damping + 3}, true)} title="Меньше перелёта и дрожания">
              мягче
            </button>
            <button className="preset" onClick={() => onChange({...curve, damping: Math.max(4, curve.damping - 3)}, true)} title="Больше перелёта">
              упруже
            </button>
            <button className="preset" onClick={() => onChange({...curve, stiffness: curve.stiffness + 40}, true)} title="Пружина срабатывает быстрее">
              быстрее
            </button>
            <button className="preset" onClick={() => onChange({...curve, stiffness: Math.max(20, curve.stiffness - 40)}, true)} title="Пружина срабатывает медленнее">
              медленнее
            </button>
          </div>
          <div className="field-grid" style={{marginTop: 8}}>
            <NumField label="Затухание" value={curve.damping} step={0.5} onChange={(v, h) => onChange({...curve, damping: Math.max(1, v)}, h)} />
            <NumField label="Жёсткость" value={curve.stiffness} step={5} onChange={(v, h) => onChange({...curve, stiffness: Math.max(10, v)}, h)} />
          </div>
        </>
      ) : (
        <div style={{fontSize: 12, opacity: 0.45, marginTop: 6, fontVariantNumeric: 'tabular-nums'}}>
          cubic-bezier({curve.v.join(', ')})
        </div>
      )}
      <div className="presets">
        {Object.entries(CURVE_PRESETS).map(([name, c]) => (
          <button key={name} className={`preset ${presetName === name ? 'on' : ''}`} onClick={() => onChange(c, true)}>
            {name}
          </button>
        ))}
      </div>
    </div>
  );
};
