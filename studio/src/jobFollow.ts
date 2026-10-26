import {useEffect} from 'react';
import {api} from './api';
import {useStudio} from './store';

/** a log line that means the agent just wrote project code or the manifest */
const WROTE = /^(Пишет|Правит) (project\.json|src\/)/;

/**
 * Follows the agent at the top of the app, not inside the chat: a job started from
 * the backlog, a comment, another tab or before a page reload is picked up here, the
 * preview reloads after every file the agent writes, and the project reloads when
 * the job ends — whether or not the chat is open.
 */
export const useJobFollow = () => {
  const projectId = useStudio((s) => s.project?.id);
  const activeJobId = useStudio((s) => s.activeJobId);

  // discover a running job of the open project
  useEffect(() => {
    if (!projectId) return;
    useStudio.getState().setResumable(null);
    let stop = false;
    const tick = async () => {
      if (useStudio.getState().activeJobId) return;
      const h = await api.chatHistory(projectId).catch(() => null);
      if (stop || !h) return;
      if (h.running && !useStudio.getState().activeJobId) useStudio.getState().setActiveJob(h.running.id);
      else if (!h.running && (h.resumable?.jobId ?? null) !== (useStudio.getState().resumable?.jobId ?? null)) {
        useStudio.getState().setResumable(h.resumable ?? null);
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [projectId]);

  // follow the active job's log
  useEffect(() => {
    if (!activeJobId) return;
    let stop = false;
    let since = 0;
    let shownApproval = '';
    let reload: ReturnType<typeof setTimeout> | null = null;
    const st = () => useStudio.getState();
    st().setJobState(null, []);
    const tick = async () => {
      const j = await api.job(activeJobId, since).catch(() => null);
      if (stop) return;
      if (!j) {
        setTimeout(tick, 2000);
        return;
      }
      since = j.logTotal;
      st().setJobState(j, j.log.length ? [...st().jobLog, ...j.log].slice(-400) : st().jobLog);
      // a paid call waits for the user: open the chat once per request so the card is seen
      const pending = j.approvals?.find((a) => a.status === 'pending');
      if (pending && pending.id !== shownApproval) {
        shownApproval = pending.id;
        if (!(st().panelOpen && st().panelTab === 'chat')) st().setPanelTab('chat');
      }
      if (j.status === 'running') {
        // a write is logged when the tool is called; give it a moment to land on disk
        if (j.log.some((l) => l.kind === 'tool' && WROTE.test(l.text))) {
          if (reload) clearTimeout(reload);
          reload = setTimeout(() => st().reloadProject().catch(() => undefined), 2500);
        }
        setTimeout(tick, 1000);
      } else {
        if (reload) clearTimeout(reload);
        if (st().project?.id === j.projectId) await st().reloadProject().catch(() => undefined);
        st().setActiveJob(null);
        st().bumpChat();
      }
    };
    tick();
    return () => {
      stop = true;
      if (reload) clearTimeout(reload);
    };
  }, [activeJobId]);
};
