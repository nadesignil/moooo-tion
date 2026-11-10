import {useState} from 'react';
import {IconChevronDown, IconChevronUp, IconListCheck, IconMessageCircle, IconPhoto} from '@tabler/icons-react';
import {useStudio, type PanelTab} from '../store';
import {AgentChat} from './AgentChat';
import {ASSET_MIME, Assets} from './Assets';
import {Edits} from './Edits';

const TITLES: Record<PanelTab, string> = {chat: 'Чат с агентом', edits: 'Правки', assets: 'Ассеты'};

/**
 * The drawer with the chat, the edits and the asset bin. Closed, it slides down and only its
 * tongue (the tabs) stays on screen; open, its top edge can be dragged.
 */
export const Drawer: React.FC = () => {
  const project = useStudio((s) => s.project);
  const sceneId = useStudio((s) => s.sceneId);
  const open = useStudio((s) => s.panelOpen);
  const setOpen = useStudio((s) => s.setPanelOpen);
  const tab = useStudio((s) => s.panelTab);
  const setTab = useStudio((s) => s.setPanelTab);
  const activeJobId = useStudio((s) => s.activeJobId);
  const waitsApproval = useStudio((s) => Boolean(s.job?.approvals?.some((a) => a.status === 'pending')));
  const drawerH = useStudio((s) => s.drawerH);
  const setDrawerH = useStudio((s) => s.setDrawerH);
  const attachExisting = useStudio((s) => s.attachExisting);
  const [assetOver, setAssetOver] = useState(false);
  // a tab switch animates the height; a drag follows the pointer without easing
  const [dragging, setDragging] = useState(false);
  if (!project) return null;

  const scene = project.scenes.find((s) => s.id === sceneId);
  const scenes = scene ? [scene] : project.scenes;
  const editCount = scenes.reduce((n, s) => n + s.backlog.length, 0);

  const pick = (t: PanelTab) => {
    if (open && tab === t) setOpen(false);
    else setTab(t);
  };

  const resize = (e: React.PointerEvent) => {
    if (!open) return;
    e.preventDefault();
    setDragging(true);
    const move = (ev: PointerEvent) => setDrawerH(window.innerHeight - ev.clientY);
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <section
      className={`drawer ${open ? 'open' : ''}`}
      style={{height: drawerH, transform: open ? 'none' : `translateY(${drawerH}px)`, transition: dragging ? 'none' : undefined}}
    >
      <div className="tongue">
        {/* an asset from the bin dropped on the chat tab joins the message draft */}
        <button
          className={`${open && tab === 'chat' ? 'on' : ''} ${assetOver ? 'drop' : ''}`}
          onClick={() => pick('chat')}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(ASSET_MIME)) return;
            e.preventDefault();
            setAssetOver(true);
          }}
          onDragLeave={() => setAssetOver(false)}
          onDrop={(e) => {
            const raw = e.dataTransfer.getData(ASSET_MIME);
            setAssetOver(false);
            if (!raw) return;
            e.preventDefault();
            e.stopPropagation();
            attachExisting([JSON.parse(raw)]);
          }}
        >
          {activeJobId ? <span className="job-dot" /> : <IconMessageCircle size={16} stroke={1.5} />}
          Чат{waitsApproval ? ' · ждёт разрешения' : activeJobId ? ' · агент работает' : ''}
        </button>
        <button className={open && tab === 'edits' ? 'on' : ''} onClick={() => pick('edits')}>
          <IconListCheck size={16} stroke={1.5} /> Правки · {editCount}
        </button>
        <button className={open && tab === 'assets' ? 'on' : ''} onClick={() => pick('assets')}>
          <IconPhoto size={16} stroke={1.5} /> Ассеты
        </button>
        <button className="tongue-toggle" onClick={() => (open ? setOpen(false) : setTab(tab))} title={open ? 'Убрать штору' : 'Показать штору'}>
          {open ? <IconChevronDown size={18} /> : <IconChevronUp size={18} />}
        </button>
      </div>
      <div className="drawer-grip" onPointerDown={resize} title="Потяните, чтобы изменить высоту" />
      <div className="drawer-head">
        <h2>
          {TITLES[tab]} <span>· {tab === 'assets' ? 'весь проект' : scene ? scene.title : 'весь проект'}</span>
        </h2>
      </div>
      <div className="drawer-body">
        {open && tab === 'chat' ? <AgentChat key={project?.id} /> : null}
        {open && tab === 'edits' ? <Edits /> : null}
        {open && tab === 'assets' ? <Assets /> : null}
      </div>
    </section>
  );
};
