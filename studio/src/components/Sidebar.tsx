import {useEffect, useState} from 'react';
import {IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand, IconChevronRight, IconCopy, IconPlus, IconSettings, IconSparkles, IconTrash} from '@tabler/icons-react';
import {api, type ProjectSummary} from '../api';
import {useStudio} from '../store';
import {plural, sec} from '../format';
import {connectorLabel, useConnectors} from '../connectors';
import {ClaudeMark, MagnificMark} from './BrandMarks';
import {Logo} from './Logo';

/** Claude + generation connectors at the bottom of the sidebar; Higgsfield only when it is connected */
const ConnectionTiles: React.FC = () => {
  const setModal = useStudio((s) => s.setModal);
  const status = useConnectors();
  const saved = JSON.parse(localStorage.getItem('moootion:claude') ?? 'null') as {model?: string} | null;
  const model = status?.model || saved?.model || '';
  const claudeState = !status ? 'wait' : status.error ? 'bad' : 'ok';
  const gen = (status?.connectors ?? []).filter((c) => c.id === 'magnific' || (c.id === 'higgsfield' && c.status === 'connected'));
  if (status && !status.error && !gen.some((c) => c.id === 'magnific')) gen.unshift({id: 'magnific', name: 'Magnific', status: 'missing', tools: 0});

  return (
    <div className="user">
      <button className="user-card claude" onClick={() => setModal('settings')} title={status?.error ?? 'Настройки подключения Claude'}>
        <span className="user-avatar claude">
          <ClaudeMark size={20} />
        </span>
        <span className="user-text">
          <b>Claude</b>
          <small>{claudeState === 'wait' ? 'проверяю…' : claudeState === 'bad' ? 'нет связи — откройте настройки' : [status?.plan ?? 'подписка', model.replace(/^claude-/, '')].filter(Boolean).join(' · ')}</small>
        </span>
        <span className={`conn-state ${claudeState}`} />
      </button>
      {gen.map((c) => {
        const ok = c.status === 'connected';
        const hint =
          c.status === 'missing'
            ? 'подключите коннектор в claude.ai'
            : ok
              ? `генерация · ${c.tools} инструментов`
              : connectorLabel(c.status);
        return (
          <div
            key={c.id}
            className={`user-card gen ${c.id}`}
            title={
              ok
                ? `${c.name}: коннектор claude.ai. Платные вызовы агент делает только после вашего «Разрешить» в чате.`
                : `${c.name}: подключите коннектор на claude.ai → Настройки → Коннекторы, затем обновите студию.`
            }
          >
            <span className={`user-avatar ${c.id}`}>
              {c.id === 'magnific' ? <MagnificMark size={17} /> : <IconSparkles size={18} stroke={1.8} />}
            </span>
            <span className="user-text">
              <b>{c.name}</b>
              <small>{hint}</small>
            </span>
            <span className={`conn-state ${ok ? 'ok' : c.status === 'pending' ? 'wait' : 'bad'}`} />
          </div>
        );
      })}
    </div>
  );
};

/** one project in the list; on hover — copy and delete (delete asks for a second click) */
const ProjectRow: React.FC<{p: ProjectSummary; active: boolean; onToast: (t: string) => void}> = ({p, active, onToast}) => {
  const openProject = useStudio((s) => s.openProject);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 3000);
    return () => clearTimeout(t);
  }, [confirm]);

  const duplicate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const {projectId} = await api.duplicateProject(p.id);
      await useStudio.getState().loadProjects();
      await openProject(projectId);
    } catch (err) {
      onToast(`Не удалось скопировать: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm) return setConfirm(true);
    setBusy(true);
    try {
      const {trash} = await api.deleteProject(p.id);
      const st = useStudio.getState();
      await st.loadProjects();
      if (active) {
        const next = useStudio.getState().projects[0];
        if (next) await openProject(next.id);
        else useStudio.setState({project: null, stages: null});
      }
      onToast(`Проект «${p.title}» удалён — папка лежит в ${trash}`);
    } catch (err) {
      onToast(`Не удалось удалить: ${(err as Error).message}`);
      setBusy(false);
      setConfirm(false);
    }
  };

  return (
    <div className={`proj ${active ? 'active' : ''} ${confirm ? 'confirm' : ''}`} role="button" tabIndex={0} onClick={() => openProject(p.id)}>
      <span className="proj-thumb" style={p.cover ? {backgroundImage: `url(${p.cover})`} : undefined} />
      <span className="proj-text">
        <b>{p.title}</b>
        <small>
          {p.scenes} {plural(p.scenes, 'сцена', 'сцены', 'сцен')} · {sec(p.seconds)}
        </small>
      </span>
      <span className="proj-actions">
        <button className="icon-btn" title="Копия проекта" onClick={duplicate} disabled={busy}>
          <IconCopy size={16} stroke={1.5} />
        </button>
        <button className={`icon-btn danger ${confirm ? 'armed' : ''}`} title={confirm ? 'Нажмите ещё раз — удалить' : 'Удалить проект'} onClick={remove} disabled={busy}>
          <IconTrash size={16} stroke={1.5} />
          {confirm ? <em>Удалить?</em> : null}
        </button>
      </span>
      <IconChevronRight className="proj-chevron" size={17} stroke={1.5} />
    </div>
  );
};

export const Sidebar: React.FC<{onToast: (t: string) => void}> = ({onToast}) => {
  const projects = useStudio((s) => s.projects);
  const current = useStudio((s) => s.project?.id);
  const open = useStudio((s) => s.sidebarOpen);
  const setOpen = useStudio((s) => s.setSidebarOpen);
  const setModal = useStudio((s) => s.setModal);

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <Logo />
        <div className="sidebar-tools">
          <button className="icon-btn settings-btn" onClick={() => setModal('settings')} title="Настройки и подключения">
            <IconSettings size={21} stroke={1.5} />
          </button>
          <button className="icon-btn" onClick={() => setOpen(!open)} title={open ? 'Свернуть' : 'Развернуть'}>
            {open ? <IconLayoutSidebarLeftCollapse size={24} stroke={1.5} /> : <IconLayoutSidebarLeftExpand size={24} stroke={1.5} />}
          </button>
        </div>
      </div>

      <div className="projects">
        <button className="new-project" onClick={() => setModal('new-project')}>
          <span>Новый проект</span>
          <IconPlus size={17} stroke={1.5} />
        </button>
        <div className="proj-list">
          {projects.map((p) => (
            <ProjectRow key={p.id} p={p} active={p.id === current} onToast={onToast} />
          ))}
        </div>
      </div>

      <ConnectionTiles />
    </aside>
  );
};
