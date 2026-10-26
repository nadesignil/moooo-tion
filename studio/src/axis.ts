import {useCallback, useEffect, useRef} from 'react';
import {useStudio, viewScenes} from './store';

export const GUTTER = 52;
const RIGHT_PAD = 26;

/** Shared time axis for ruler, subscene cards and the action scheme. */
export const useAxis = () => {
  const project = useStudio((s) => s.project);
  const sceneId = useStudio((s) => s.sceneId);
  const zoomed = useStudio((s) => s.zoomed);
  const viewW = useStudio((s) => s.viewW);
  const scrollX = useStudio((s) => s.scrollX);
  const storedPps = useStudio((s) => s.pxPerSec);

  const view = project ? viewScenes(project, sceneId) : null;
  const span = view ? Math.max(0.5, view.to - view.from) : 1;
  const fitPps = Math.max(10, (viewW - GUTTER - RIGHT_PAD) / span);
  const pps = zoomed ? storedPps : fitPps;
  const from = view?.from ?? 0;
  const to = view?.to ?? 1;

  const x = useCallback((t: number) => GUTTER + (t - from) * pps - (zoomed ? scrollX : 0), [from, pps, scrollX, zoomed]);
  const t = useCallback((px: number) => (px - GUTTER + (zoomed ? scrollX : 0)) / pps + from, [from, pps, scrollX, zoomed]);

  return {view, from, to, pps, fitPps, x, t, scrollX: zoomed ? scrollX : 0, viewW};
};

/**
 * Wheel on a time area (native, non-passive so the page never scrolls):
 *   wheel            — zoom around the cursor (over the ruler and the cards)
 *   Ctrl+wheel       — zoom anywhere
 *   Shift+wheel / ←→ — scroll along time
 * With `plain: 'scroll'` (the action rows) a plain wheel is left to the browser, so the
 * rows scroll like any list and only Ctrl+wheel zooms.
 */
export const useWheelZoom = (ref: React.RefObject<HTMLElement | null>, opts: {plain?: 'zoom' | 'scroll'} = {}) => {
  const axis = useAxis();
  const latest = useRef(axis);
  latest.current = axis;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const a = latest.current;
      const {setView} = useStudio.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      if (opts.plain === 'scroll' && !ctrl && !e.shiftKey && Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const span = a.to - a.from;
      const maxScroll = (pps: number) => Math.max(0, span * pps - (a.viewW - GUTTER - RIGHT_PAD));
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const d = e.shiftKey ? e.deltaY || e.deltaX : e.deltaX;
        if (maxScroll(a.pps) <= 0) return;
        setView({zoomed: true, pxPerSec: a.pps, scrollX: Math.min(maxScroll(a.pps), Math.max(0, a.scrollX + d))});
        return;
      }
      const tAtCursor = a.t(mx);
      // wheel up = zoom in, wheel down = zoom out (never below "whole view")
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      const pps = Math.min(4000, Math.max(a.fitPps, a.pps * Math.exp(-delta * 0.002)));
      if (pps <= a.fitPps * 1.001) {
        setView({zoomed: false, scrollX: 0});
        return;
      }
      const scroll = (tAtCursor - a.from) * pps - (mx - GUTTER);
      setView({zoomed: true, pxPerSec: pps, scrollX: Math.min(maxScroll(pps), Math.max(0, scroll))});
    };
    el.addEventListener('wheel', onWheel, {passive: false});
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref, opts.plain]);
};

/** nice tick steps for the ruler */
export const tickSteps = (pps: number, fps: number) => {
  const minors = [1 / fps, 2 / fps, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10];
  const majors = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60];
  const minor = minors.find((s) => s * pps >= 8) ?? 10;
  const major = majors.find((s) => s * pps >= 84) ?? 60;
  return {minor, major};
};
