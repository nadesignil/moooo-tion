import {useEffect, useMemo, useRef, useState} from 'react';
import {Player, type PlayerRef} from '@remotion/player';
import {IconX} from '@tabler/icons-react';
import {ProjectVideo, projectFrames} from '../../../runtime';
import {findAction, sceneOffsets, useStudio, type PreviewSize} from '../store';
import {sec2} from '../format';

export const ACTION_SIZES: Record<PreviewSize, number> = {S: 360, M: 520, L: 720};
/** the inspector's width with its margin and a gap */
const INSPECTOR_W = 380 + 18 + 16;

/**
 * The selected action's stretch of the film, looping, in its own window next to the
 * inspector — resizable like the full preview. Every edit of the action (time, curve,
 * params) restarts it from the beginning of the stretch, so the change is seen whole.
 */
export const ActionPreviewWindow: React.FC = () => {
  const project = useStudio((s) => s.project);
  const stages = useStudio((s) => s.stages);
  const selected = useStudio((s) => s.selected);
  const pref = useStudio((s) => s.actionPreview);
  const setPref = useStudio((s) => s.setActionPreview);
  const setPlayhead = useStudio((s) => s.setPlayhead);
  const ref = useRef<PlayerRef>(null);
  const [pos, setPos] = useState<{x: number; y: number} | null>(null);
  const inputProps = useMemo(() => (project && stages ? {project, stages} : null), [project, stages]);

  const found = project ? findAction(project, selected) : null;
  const fps = project?.fps ?? 60;
  const off = project && found ? (sceneOffsets(project).get(found.scene.id) ?? 0) : 0;
  const total = project ? projectFrames(project) : 1;
  const pad = Math.round(fps * 0.2);
  const from = found ? Math.max(Math.round(off * fps), Math.round((off + found.action.start) * fps) - pad) : 0;
  const to = found
    ? Math.min(total - 1, Math.round((off + found.scene.duration) * fps) - 1, Math.round((off + found.action.start + found.action.duration) * fps) + pad)
    : 1;
  const sig = found ? JSON.stringify(found.action) : '';
  const actionKey = found ? `${found.scene.id}/${found.action.id}` : '';

  // restart after the edit settles (a drag sends dozens of changes); a new action starts on its own
  const lastKey = useRef('');
  useEffect(() => {
    const sameAction = actionKey && actionKey === lastKey.current;
    lastKey.current = actionKey;
    if (!sameAction) return;
    const t = setTimeout(() => {
      const p = ref.current;
      if (!p) return;
      p.seekTo(from);
      p.play();
    }, 220);
    return () => clearTimeout(t);
  }, [sig, from, actionKey]);

  // dev only: lets the browser console check the restart
  useEffect(() => {
    if (import.meta.env.DEV) (globalThis as unknown as {__segment: PlayerRef | null}).__segment = ref.current;
  });

  if (!project || !inputProps || !found || !pref.open) return null;
  const w = ACTION_SIZES[pref.size];
  const h = Math.round((w * project.height) / project.width);
  // docked left of the inspector until moved
  const x = Math.max(0, Math.min(pos?.x ?? window.innerWidth - INSPECTOR_W - w, window.innerWidth - w));
  const y = Math.max(0, Math.min(pos?.y ?? 150, window.innerHeight - h - 60));

  const dragWin = (e: React.PointerEvent) => {
    const x0 = e.clientX - x;
    const y0 = e.clientY - y;
    const move = (ev: PointerEvent) => setPos({x: ev.clientX - x0, y: Math.max(0, ev.clientY - y0)});
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="preview action-preview" style={{left: x, top: y, width: w}}>
      <div className="preview-head" onPointerDown={dragWin}>
        <span>Действие</span>
        <span className="t">«{found.action.title}»</span>
        <span className="sp" />
        {(Object.keys(ACTION_SIZES) as PreviewSize[]).map((k) => (
          <button key={k} className={`icon-btn ${pref.size === k ? 'on' : ''}`} onPointerDown={(e) => e.stopPropagation()} onClick={() => setPref({size: k})}>
            {k}
          </button>
        ))}
        <button className="icon-btn" onPointerDown={(e) => e.stopPropagation()} onClick={() => setPref({open: false})} title="Скрыть превью действия">
          <IconX size={16} />
        </button>
      </div>
      <Player
        key={actionKey}
        ref={ref}
        component={ProjectVideo}
        inputProps={inputProps}
        durationInFrames={total}
        compositionWidth={project.width}
        compositionHeight={project.height}
        fps={fps}
        inFrame={from}
        outFrame={Math.max(from + 1, to)}
        initialFrame={from}
        loop
        autoPlay
        initiallyMuted
        clickToPlay={false}
        style={{width: w, height: h}}
      />
      <div className="segment-meta action-preview-meta">
        <span>
          участок {sec2(found.action.start)}–{sec2(found.action.start + found.action.duration)} с · повтор · после правки — с начала
        </span>
        <button className="msg-btn" onClick={() => setPlayhead(off + found.action.start)} title="Поставить плейхед на начало действия">
          к началу
        </button>
      </div>
    </div>
  );
};
