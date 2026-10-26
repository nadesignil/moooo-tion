import {useRef} from 'react';
import {tickSteps, useAxis, useWheelZoom} from '../axis';
import {snapToFrame, useStudio} from '../store';
import {sec} from '../format';

export const Ruler: React.FC = () => {
  const project = useStudio((s) => s.project);
  const playhead = useStudio((s) => s.playhead);
  const setPlayhead = useStudio((s) => s.setPlayhead);
  const openEdit = useStudio((s) => s.openEdit);
  const axis = useAxis();
  const ref = useRef<HTMLDivElement>(null);
  useWheelZoom(ref);
  if (!project || !axis.view) return <div className="tv ruler" ref={ref} />;

  const fps = project.fps;
  const {minor, major} = tickSteps(axis.pps, fps);
  const visFrom = Math.max(axis.from, axis.t(0));
  const visTo = Math.min(axis.to, axis.t(axis.viewW));
  const ticks: React.ReactNode[] = [];
  const first = Math.ceil(visFrom / minor - 1e-6) * minor;
  for (let t = first; t <= visTo + 1e-6; t += minor) {
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
    ticks.push(<span key={`t${t.toFixed(4)}`} className={`ruler-tick ${isMajor ? '' : 'minor'}`} style={{left: axis.x(t)}} />);
    if (isMajor) {
      ticks.push(
        <span key={`l${t.toFixed(4)}`} className={`ruler-label ${t === axis.from ? 'first' : ''}`} style={{left: axis.x(t)}}>
          {sec(t - axis.from)}
        </span>,
      );
    }
  }

  // subscene starts (lime marks) and edits pinned to frames (yellow; a click opens the edit)
  const marks: React.ReactNode[] = [];
  for (const scene of axis.view.scenes) {
    const off = axis.view.offsets.get(scene.id) ?? 0;
    scene.groups.forEach((g, i) => {
      if (i > 0) marks.push(<span key={`m${scene.id}${g.id}`} className="ruler-mark" style={{left: axis.x(off + g.from)}} />);
    });
    scene.backlog.forEach((b) =>
      marks.push(
        <span
          key={`s${b.id}`}
          className={`ruler-seam ${b.kind}`}
          style={{left: axis.x(off + b.at)}}
          title={`${b.text || 'Правка без текста'} — открыть`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => openEdit(scene.id, b.id)}
        />,
      ),
    );
  }

  const scrub = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = ref.current!.getBoundingClientRect();
    const go = (cx: number) => setPlayhead(snapToFrame(axis.t(cx - rect.left), fps));
    go(e.clientX);
    const move = (ev: PointerEvent) => go(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="tv ruler" ref={ref} onPointerDown={scrub}>
      <div className="tv-inner">
        {ticks}
        {marks}
        <div className="playhead" style={{left: axis.x(playhead)}} />
      </div>
    </div>
  );
};
