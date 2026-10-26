import {useEffect} from 'react';
import {findAction, snapToFrame, useStudio, viewScenes} from './store';
import {playerRef} from './components/PreviewWindow';

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

/** NLE-style keys (Premiere / Clipchamp habits). */
export const useShortcuts = (opts: {showBacklog: () => void}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const s = useStudio.getState();
      if (s.modal) return;
      if (e.key === '?') {
        s.setModal('shortcuts');
        return;
      }
      const p = s.project;
      if (!p) return;
      const fps = p.fps;
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (ctrl && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (ctrl && key === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }
      if (ctrl) return;

      switch (e.key) {
        case ' ': {
          e.preventDefault();
          if (!s.previewOpen) {
            s.setPreviewOpen(true);
            setTimeout(() => playerRef.current?.play(), 150);
          } else playerRef.current?.toggle();
          return;
        }
        case 'ArrowLeft':
        case 'ArrowRight': {
          e.preventDefault();
          const step = (e.shiftKey ? 10 : 1) / fps;
          s.setPlayhead(snapToFrame(s.playhead + (e.key === 'ArrowLeft' ? -step : step), fps));
          return;
        }
        case 'Home':
          s.setPlayhead(viewScenes(p, s.sceneId).from);
          return;
        case 'End':
          s.setPlayhead(viewScenes(p, s.sceneId).to - 1 / fps);
          return;
        case 'Escape':
          s.select(null);
          s.selectLayer(null);
          return;
        case '\\':
          s.setView({zoomed: false, scrollX: 0});
          return;
        case '=':
        case '+':
          s.setView({zoomed: true, pxPerSec: s.pxPerSec * 1.25});
          return;
        case '-':
          s.setView({zoomed: true, pxPerSec: s.pxPerSec / 1.25});
          return;
      }

      // P — pause: everything after the playhead moves later (Shift — a whole second)
      if (key === 'p' || key === 'з') {
        e.preventDefault();
        s.insertPause(s.playhead, e.shiftKey ? 1 : 0.5);
        return;
      }

      // C — cut: a seam where an effect or a prompt for the agent goes
      if (key === 'c' || key === 'с') {
        e.preventDefault();
        const view = viewScenes(p, s.sceneId);
        const scene = view.scenes.find((sc) => {
          const off = view.offsets.get(sc.id) ?? 0;
          return s.playhead >= off && s.playhead < off + sc.duration;
        });
        if (!scene) return;
        const at = snapToFrame(s.playhead - (view.offsets.get(scene.id) ?? 0), fps);
        const sel = findAction(p, s.selected);
        const action =
          sel && sel.scene.id === scene.id && at > sel.action.start && at < sel.action.start + sel.action.duration
            ? sel.action
            : scene.actions.find((a) => at > a.start && at < a.start + a.duration);
        s.addBacklog(scene.id, {kind: 'prompt', at, actionId: action?.id, text: ''});
        opts.showBacklog();
        return;
      }

      // Delete — removing a motion needs the agent (code reads it)
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const sel = findAction(p, s.selected);
        if (!sel) return;
        s.addBacklog(sel.scene.id, {
          kind: 'prompt',
          at: sel.action.start,
          actionId: sel.action.id,
          text: `Убрать движение «${sel.action.title}»`,
        });
        opts.showBacklog();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [opts]);
};
