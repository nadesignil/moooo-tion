import {Component, useEffect, useMemo, useRef, useState} from 'react';
import {Player, type PlayerRef} from '@remotion/player';
import {IconX} from '@tabler/icons-react';
import {ProjectVideo, isVariants, projectFrames, sceneFrames} from '../../../runtime';
import {findAction, sceneOffsets, useStudio} from '../store';
import {ACTION_SIZES} from './ActionPreviewWindow';

export const playerRef: {current: PlayerRef | null} = {current: null};

const SIZES = {S: 480, M: 720, L: 960} as const;
/** the inspector's width with its margin and a gap: the preview never covers it */
const INSPECTOR_W = 380 + 18 + 16;

/** A broken scene must not take the whole studio down with it. */
class PlayerBoundary extends Component<{children: React.ReactNode; resetKey: string}, {error: string | null}> {
  state = {error: null as string | null};
  static getDerivedStateFromError(err: unknown) {
    return {error: err instanceof Error ? err.message : String(err)};
  }
  componentDidUpdate(prev: {resetKey: string}) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({error: null});
  }
  render() {
    if (this.state.error) return <div className="preview-error">Превью упало: {this.state.error}</div>;
    return this.props.children;
  }
}

/** Floating preview window with the live Remotion Player. A click on an object selects its layer. */
export const PreviewWindow: React.FC = () => {
  const project = useStudio((s) => s.project);
  const stages = useStudio((s) => s.stages);
  const open = useStudio((s) => s.previewOpen);
  const setOpen = useStudio((s) => s.setPreviewOpen);
  const playhead = useStudio((s) => s.playhead);
  const setPlayhead = useStudio((s) => s.setPlayhead);
  const setPlaying = useStudio((s) => s.setPlaying);
  const selectedLayer = useStudio((s) => s.selectedLayer);
  const selectLayer = useStudio((s) => s.selectLayer);
  const inspectorOpen = useStudio((s) => Boolean(s.selected || s.selectedLayer));
  // the action's own preview sits left of the inspector: step left of it too
  const actionPreviewW = useStudio((s) => (s.selected && s.actionPreview.open ? ACTION_SIZES[s.actionPreview.size] + 16 : 0));
  const [size, setSize] = useState<keyof typeof SIZES>('M');
  const [pos, setPos] = useState(() => ({x: window.innerWidth - SIZES.M - 40, y: 150}));
  const ref = useRef<PlayerRef>(null);
  const fromPlayer = useRef(-1);
  /** frame where an automatic replay of the edited action stops (-1 = none) */
  const stopAt = useRef(-1);
  const autoReplay = useStudio((s) => s.autoReplay);
  // the selected action with its place in the film, as a string: changes only when it is edited
  const editedSig = useStudio((s) => {
    const f = s.project ? findAction(s.project, s.selected) : null;
    return f ? `${f.scene.id}/${f.action.id}|${JSON.stringify(f.action)}` : '';
  });
  const total = project ? projectFrames(project) : 1;
  // «Оживление скриншота»: the player loops the selected variant only
  const sceneId = useStudio((s) => s.sceneId);
  const range = useMemo(() => {
    if (!project || !isVariants(project) || !sceneId) return null;
    let from = 0;
    for (const s of project.scenes) {
      const dur = sceneFrames(s, project.fps);
      if (s.id === sceneId) return {inFrame: from, outFrame: Math.min(total - 1, from + dur - 1)};
      from += dur;
    }
    return null;
  }, [project, sceneId, total]);
  // the Player starts where the playhead was when the window opened; always inside the film
  // (the Player validates this prop on every render, so it is clamped whenever the film shrinks)
  const initialFrame = useMemo(
    () =>
      Math.min(
        range?.outFrame ?? total - 1,
        Math.max(range?.inFrame ?? 0, Math.round(useStudio.getState().playhead * (project?.fps ?? 60))),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, project?.id, total, range?.inFrame, range?.outFrame],
  );

  const inputProps = useMemo(() => (project && stages ? {project, stages} : null), [project, stages]);

  // player → playhead
  useEffect(() => {
    const p = ref.current;
    playerRef.current = p;
    // dev only: drive the player from the browser console
    if (import.meta.env.DEV) (globalThis as unknown as {__player: PlayerRef | null}).__player = p;
    if (!p || !project) return;
    // frame events arrive inside React's commit; push them to the store at most once per animation frame
    let raf = 0;
    const onFrame = (e: {detail: {frame: number}}) => {
      fromPlayer.current = e.detail.frame;
      if (stopAt.current >= 0 && e.detail.frame >= stopAt.current) {
        stopAt.current = -1;
        p.pause();
      }
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const t = fromPlayer.current / project.fps;
        if (Math.abs(useStudio.getState().playhead - t) > 1e-6) setPlayhead(t);
      });
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    p.addEventListener('frameupdate', onFrame);
    p.addEventListener('play', onPlay);
    p.addEventListener('pause', onPause);
    return () => {
      cancelAnimationFrame(raf);
      p.removeEventListener('frameupdate', onFrame);
      p.removeEventListener('play', onPlay);
      p.removeEventListener('pause', onPause);
    };
  }, [open, project?.fps, setPlayhead, setPlaying]);

  // an edit of the selected action replays its stretch from the start (after the edit settles)
  const lastSel = useRef('');
  useEffect(() => {
    const id = editedSig.split('|')[0];
    const sameAction = id && id === lastSel.current;
    lastSel.current = id;
    if (!sameAction || !open || !autoReplay) return;
    const t = setTimeout(() => {
      const st = useStudio.getState();
      const p = ref.current;
      const f = st.project ? findAction(st.project, st.selected) : null;
      if (!p || !f || !st.project) return;
      const fps = st.project.fps;
      const off = sceneOffsets(st.project).get(f.scene.id) ?? 0;
      const pad = Math.round(fps * 0.2);
      const from = Math.max(Math.round(off * fps), Math.round((off + f.action.start) * fps) - pad);
      const to = Math.min(projectFrames(st.project) - 1, Math.round((off + f.action.start + f.action.duration) * fps) + pad);
      stopAt.current = to;
      p.seekTo(from);
      p.play();
    }, 250);
    return () => clearTimeout(t);
  }, [editedSig, open, autoReplay]);

  // the play icon of a scene/subscene card: play that stretch once (the Player mounts with the window, so wait a frame)
  const playRange = useStudio((s) => s.playRange);
  useEffect(() => {
    if (!playRange || !open || !project) return;
    const raf = requestAnimationFrame(() => {
      const p = ref.current;
      if (!p) return;
      const fps = project.fps;
      const from = Math.min(total - 1, Math.max(0, Math.round(playRange.from * fps)));
      stopAt.current = Math.min(total - 1, Math.max(from, Math.round(playRange.to * fps) - 1));
      p.seekTo(from);
      p.play();
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playRange?.n, open]);

  // playhead → player (when moved from the timeline)
  useEffect(() => {
    const p = ref.current;
    if (!p || !project || p.isPlaying()) return;
    const f = Math.round(playhead * project.fps);
    if (f !== fromPlayer.current && f !== p.getCurrentFrame()) p.seekTo(f);
  }, [playhead, project]);

  if (!open || !project || !inputProps) return null;
  const w = SIZES[size];
  const h = (w * project.height) / project.width;
  // the window stays inside the viewport and, while the inspector is open, steps left of it
  const right = window.innerWidth - (inspectorOpen ? INSPECTOR_W : 0) - actionPreviewW;
  const left = Math.max(0, Math.min(pos.x, right - w));
  const top = Math.max(0, Math.min(pos.y, window.innerHeight - h - 40));

  const dragWin = (e: React.PointerEvent) => {
    const x0 = e.clientX - pos.x;
    const y0 = e.clientY - pos.y;
    const move = (ev: PointerEvent) => setPos({x: ev.clientX - x0, y: Math.max(0, ev.clientY - y0)});
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /**
   * Which layer is under the cursor? Walk the elements under the point from the top.
   * Layer wrappers themselves are only containers and never count; invisible elements
   * (opacity 0 somewhere up to the scene) are skipped. The first visible object that is
   * not full-frame wins; full-frame elements (backgrounds) only when nothing smaller is there.
   */
  const pick = (e: React.MouseEvent) => {
    const els = document.elementsFromPoint(e.clientX, e.clientY);
    const sceneEl = els.find((el) => el.hasAttribute('data-moootion-scene'));
    if (!sceneEl) return;
    const box = sceneEl.getBoundingClientRect();
    const full = (r: DOMRect) => r.width >= box.width * 0.97 && r.height >= box.height * 0.97;
    const invisible = (el: Element) => {
      for (let n: Element | null = el; n && n !== sceneEl; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.opacity === '0' || cs.visibility === 'hidden') return true;
      }
      return false;
    };
    let fallback: Element | null = null;
    for (const el of els) {
      if (el === sceneEl) break;
      // something above the scene that is not part of it (the Player's controls): not a pick
      if (!sceneEl.contains(el)) return;
      if (el.hasAttribute('data-moootion-layer')) continue;
      const layerEl = el.closest('[data-moootion-layer]');
      if (!layerEl || invisible(el)) continue;
      if (!full(el.getBoundingClientRect())) {
        fallback = layerEl;
        break;
      }
      fallback = fallback ?? layerEl;
    }
    if (!fallback) return;
    const name = fallback.getAttribute('data-moootion-layer') ?? '';
    const sceneId = sceneEl.getAttribute('data-moootion-scene') ?? '';
    const same = selectedLayer?.sceneId === sceneId && selectedLayer.name === name;
    selectLayer(same ? null : {sceneId, name});
  };

  return (
    <div className="preview" style={{left, top, width: w}}>
      <div className="preview-head" onPointerDown={dragWin}>
        <span>Превью</span>
        <span className="t">{selectedLayer ? `слой «${selectedLayer.name}»` : project.title}</span>
        <span className="sp" />
        {(Object.keys(SIZES) as (keyof typeof SIZES)[]).map((k) => (
          <button key={k} className={`icon-btn ${size === k ? 'on' : ''}`} onPointerDown={(e) => e.stopPropagation()} onClick={() => setSize(k)}>
            {k}
          </button>
        ))}
        <button className="icon-btn" onPointerDown={(e) => e.stopPropagation()} onClick={() => setOpen(false)}>
          <IconX size={16} />
        </button>
      </div>
      {selectedLayer ? (
        <style>{`.preview [data-moootion-layer=${JSON.stringify(selectedLayer.name)}]{outline:2px solid #b4db47;outline-offset:-2px}`}</style>
      ) : null}
      <div className="preview-stage" onClick={pick} title="Клик по объекту — выбрать его слой">
        <PlayerBoundary resetKey={`${project.id}:${total}:${range?.inFrame ?? ''}`}>
          <Player
            ref={ref}
            component={ProjectVideo}
            inputProps={inputProps}
            durationInFrames={total}
            compositionWidth={project.width}
            compositionHeight={project.height}
            fps={project.fps}
            controls
            clickToPlay={false}
            doubleClickToFullscreen
            initialFrame={initialFrame}
            inFrame={range?.inFrame ?? null}
            outFrame={range?.outFrame ?? null}
            loop={Boolean(range)}
            style={{width: w, height: h}}
          />
        </PlayerBoundary>
      </div>
    </div>
  );
};
