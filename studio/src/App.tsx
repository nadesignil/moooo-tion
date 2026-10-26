import {Component, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {api} from './api';
import {useStudio} from './store';
import {useShortcuts} from './shortcuts';
import {useJobFollow} from './jobFollow';
import {ActionPreviewWindow} from './components/ActionPreviewWindow';
import {Drawer} from './components/Drawer';
import {Header} from './components/Header';
import {Inspector} from './components/Inspector';
import {LibraryModal} from './components/LibraryModal';
import {NewProjectModal} from './components/NewProjectModal';
import {PreviewWindow} from './components/PreviewWindow';
import {ProjectSettingsModal} from './components/ProjectSettingsModal';
import {Ruler} from './components/Ruler';
import {SceneBar} from './components/SceneBar';
import {SchemePanel} from './components/SchemePanel';
import {SettingsModal} from './components/SettingsModal';
import {ShortcutsModal} from './components/ShortcutsModal';
import {Sidebar} from './components/Sidebar';
import {StartForm} from './components/StartForm';
import {CardsGrip, SubsceneCards} from './components/SubsceneCards';

export const App: React.FC = () => {
  const [ready, setReady] = useState<boolean | null>(null);

  // the start form is shown until Claude was verified on this device once
  useEffect(() => {
    const saved = localStorage.getItem('moootion:claude');
    let stop = false;
    // the API server may still be starting: retry for a few seconds
    const tick = async (attempt: number) => {
      const st = await api.claudeStatus().catch(() => null);
      if (stop) return;
      if (st) setReady(Boolean(saved) && (st.login || st.apiKey));
      else if (attempt < 15) setTimeout(() => tick(attempt + 1), 700);
      else setReady(false);
    };
    tick(0);
    return () => {
      stop = true;
    };
  }, []);

  if (ready === null) return null;
  if (!ready) return <StartForm onReady={() => setReady(true)} />;
  return (
    <RootBoundary>
      <Workspace />
    </RootBoundary>
  );
};

/** Never a blank page: show what broke and offer a reload. */
class RootBoundary extends Component<{children: React.ReactNode}, {error: string | null}> {
  state = {error: null as string | null};
  static getDerivedStateFromError(err: unknown) {
    return {error: err instanceof Error ? err.message : String(err)};
  }
  render() {
    if (this.state.error) {
      return (
        <div className="empty-state" style={{height: '100vh'}}>
          <h2>Студия споткнулась</h2>
          <p style={{maxWidth: 640, opacity: 0.7}}>{this.state.error}</p>
          <button className="pill solid" onClick={() => location.reload()}>
            Перезагрузить
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const Workspace: React.FC = () => {
  const loadProjects = useStudio((s) => s.loadProjects);
  const openProject = useStudio((s) => s.openProject);
  const project = useStudio((s) => s.project);
  const projects = useStudio((s) => s.projects);
  const loadError = useStudio((s) => s.loadError);
  const sidebarOpen = useStudio((s) => s.sidebarOpen);
  const setView = useStudio((s) => s.setView);
  const modal = useStudio((s) => s.modal);
  const drawerOpen = useStudio((s) => s.panelOpen);
  const drawerH = useStudio((s) => s.drawerH);
  const setModal = useStudio((s) => s.setModal);
  const fileDrag = useStudio((s) => s.fileDrag);
  const [toast, setToast] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dragTimer = useRef(0);

  // files dragged anywhere over the studio go to the chat: open it, show the target, attach on drop
  const dragOver = (e: React.DragEvent) => {
    if (!project || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const st = useStudio.getState();
    // the open asset bin takes the files itself (its own drop zone)
    if (st.panelOpen && st.panelTab === 'assets') return;
    if (!st.fileDrag) {
      st.setFileDrag(true);
      if (!(st.panelOpen && st.panelTab === 'chat')) st.setPanelTab('chat');
    }
    // dragover keeps firing while the files are over the window; silence means they left
    window.clearTimeout(dragTimer.current);
    dragTimer.current = window.setTimeout(() => useStudio.getState().setFileDrag(false), 300);
  };
  const drop = (e: React.DragEvent) => {
    if (!project || !e.dataTransfer.files.length) return;
    e.preventDefault();
    window.clearTimeout(dragTimer.current);
    const st = useStudio.getState();
    st.setFileDrag(false);
    if (st.panelOpen && st.panelTab === 'assets') {
      // dropped next to the bin, not on it: add there anyway
      api.addAssets(project.id, [...e.dataTransfer.files]).then(() => st.bumpChat()).catch((err: Error) => showToast(err.message));
      return;
    }
    st.attachFiles([...e.dataTransfer.files]).catch((err: Error) => showToast(err.message));
  };

  const showToast = useCallback((t: string) => {
    setToast(t);
    setTimeout(() => setToast((cur) => (cur === t ? null : cur)), 3200);
  }, []);
  const shortcutOpts = useMemo(() => ({showBacklog: () => useStudio.getState().setPanelTab('edits')}), []);
  useShortcuts(shortcutOpts);
  useJobFollow();

  useEffect(() => {
    loadProjects().then(() => {
      setLoaded(true);
      const {projects: list} = useStudio.getState();
      const last = localStorage.getItem('moootion:lastProject');
      const id = list.find((p) => p.id === last)?.id ?? list[0]?.id;
      if (id) openProject(id);
    });
  }, [loadProjects, openProject]);

  // the time viewport follows the window width
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setView({viewW: e.contentRect.width}));
    ro.observe(el);
    return () => ro.disconnect();
  }, [setView]);

  return (
    <div className={`app ${sidebarOpen ? '' : 'sidebar-closed'}`} onDragOver={dragOver} onDrop={drop}>
      <Sidebar onToast={showToast} />
      <main className="main" style={{'--drawer-offset': `${drawerOpen ? drawerH + 12 : 64}px`} as React.CSSProperties}>
        <Header onToast={showToast} />
        <div className="body" ref={bodyRef}>
          {project ? (
            <>
              <CodeBanner />
              <div className="top">
                <SceneBar />
                <Ruler />
                <SubsceneCards />
                <CardsGrip />
              </div>
              <SchemePanel />
            </>
          ) : (
            <div className="empty-state">
              {loadError ? (
                `Не удалось открыть проект: ${loadError}`
              ) : loaded && !projects.length ? (
                <>
                  <h2>Пока нет проектов</h2>
                  <p>Создайте первый: достаточно названия, раскадровка и референс — по желанию.</p>
                  <button className="pill solid" onClick={() => setModal('new-project')}>
                    Новый проект
                  </button>
                </>
              ) : (
                'Загружаю проекты…'
              )}
            </div>
          )}
        </div>
        <Inspector onToast={showToast} />
        {project ? <Drawer /> : null}
      </main>
      <PreviewWindow />
      <ActionPreviewWindow />
      {modal === 'new-project' ? <NewProjectModal /> : null}
      {modal === 'library' ? <LibraryModal /> : null}
      {modal === 'settings' ? <SettingsModal /> : null}
      {modal === 'project-settings' && project ? <ProjectSettingsModal onToast={showToast} /> : null}
      {modal === 'shortcuts' ? <ShortcutsModal /> : null}
      {toast ? <div className="toast">{toast}</div> : null}
      {fileDrag ? (
        <div className="drop-overlay">
          <span>Отпустите — файлы прикрепятся к сообщению агенту</span>
        </div>
      ) : null}
    </div>
  );
};

/**
 * The scene code does not compile. While the agent is writing it that is a normal intermediate step (a scene in the
 * map before its file exists) — say so and wait; the preview comes back with the next write. Otherwise show the
 * error and offer a retry or a ready-made request to the agent.
 */
const CodeBanner: React.FC = () => {
  const codeError = useStudio((s) => s.codeError);
  const activeJobId = useStudio((s) => s.activeJobId);
  const projectId = useStudio((s) => s.project?.id);
  if (!codeError || !projectId) return null;
  const st = useStudio.getState();
  if (activeJobId) {
    return (
      <div className="code-banner wait">
        <b>Агент пишет код сцен</b>
        <span>Превью оживёт, когда файлы будут готовы — ход работы во вкладке «Чат».</span>
      </div>
    );
  }
  return (
    <div className="code-banner">
      <b>Код проекта не собирается</b>
      <span title={codeError}>{codeError.split('\n')[0].slice(0, 220)}</span>
      <button className="chip no-end small" onClick={() => st.reloadProject().catch(() => undefined)}>
        Проверить снова
      </button>
      <button
        className="chip no-end small"
        onClick={() => {
          st.setChatDraft(projectId, {text: `Код проекта не собирается, почини:\n${codeError}`});
          st.setPanelTab('chat');
        }}
      >
        Попросить агента починить
      </button>
    </div>
  );
};

