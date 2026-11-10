import {useEffect} from 'react';
import {api, ApiError} from './api';
import {useStudio} from './store';

/** a log line that means the agent just wrote project code or the manifest */
const WROTE = /^(Пишет|Правит) (project\.json|src\/)/;
const transportMessage = (error: unknown) => error instanceof ApiError
  ? `Сервер студии вернул ошибку ${error.status}. Статус задачи не обновляется. Повторяю проверку автоматически.`
  : 'Нет ответа от сервера студии. Статус задачи неизвестен: агент может продолжать работу. Повторяю подключение автоматически.';

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
    let busy = false;
    const tick = async () => {
      if (stop || busy || useStudio.getState().activeJobId) return;
      busy = true;
      const h = await api.chatHistory(projectId).catch(error => {
        if (!stop && useStudio.getState().project?.id === projectId) useStudio.setState({transportError:transportMessage(error)});
        return null;
      }).finally(() => {busy = false;});
      if (stop || !h || useStudio.getState().project?.id !== projectId) return;
      useStudio.setState({transportError:null});
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const again = (ms: number) => {if (!stop) timer = setTimeout(tick, ms);};
    const st = () => useStudio.getState();
    st().setJobState(null, []);
    const tick = async () => {
      if (stop) return;
      let error: unknown;
      const j = await api.job(activeJobId, since).catch(e => {error = e; return null;});
      if (stop || st().activeJobId !== activeJobId) return;
      if (!j) {
        if (error instanceof ApiError && error.status === 404) {
          // The API was restarted: its in-memory job no longer exists. Reconcile with disk history.
          const projectId = st().project?.id;
          if (!projectId) return;
          const history = await api.chatHistory(projectId).catch(() => null);
          if (stop || st().activeJobId !== activeJobId) return;
          if (history) {
            st().setActiveJob(history.running?.id ?? null);
            st().setResumable(history.resumable);
            useStudio.setState({transportError:null, connectionNotice: history.running ? null : {
              service:'Студия',state:'failed',at:Date.now(),
              message:'Предыдущая задача больше не выполняется на сервере студии. Возможно, сервер был перезапущен. Проверьте чат и нажмите «Запустить снова», чтобы продолжить.',
            }});
            st().bumpChat();
            if (history.running?.id === activeJobId) again(2000);
            return;
          }
        }
        useStudio.setState({transportError:transportMessage(error)});
        again(2000);
        return;
      }
      useStudio.setState({transportError:null});
      if (j.projectId !== st().project?.id) { st().setActiveJob(null); return; }
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
          reload = setTimeout(() => { if (st().project?.id === j.projectId) void st().reloadProject().catch(() => undefined); }, 2500);
        }
        again(1000);
      } else {
        if (reload) clearTimeout(reload);
        if (st().project?.id === j.projectId) await st().reloadProject().catch(() => undefined);
        if (stop || st().activeJobId !== activeJobId) return;
        st().setActiveJob(null);
        st().bumpChat();
      }
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
      if (reload) clearTimeout(reload);
    };
  }, [activeJobId]);
};
