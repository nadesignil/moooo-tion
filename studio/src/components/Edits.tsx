import {useEffect, useRef, useState} from 'react';
import {IconSend, IconTrash} from '@tabler/icons-react';
import type {BacklogItem, Scene} from '../../../runtime/manifest';
import {api} from '../api';
import {sceneOffsets, snapToFrame, useStudio, viewScenes} from '../store';
import {sec2} from '../format';

const KIND: Record<BacklogItem['kind'], string> = {comment: 'К кадру', prompt: 'Задача', effect: 'Замена эффекта'};

/**
 * «Правки» — one list for everything the agent should do: notes pinned to a frame
 * (the playhead, or a click on the timeline), tasks on an action, effect swaps,
 * seams. Each goes to the agent now («В чат») or with the rest («Пересчитать»).
 */
export const Edits: React.FC = () => {
  const project = useStudio((s) => s.project);
  const sceneId = useStudio((s) => s.sceneId);
  const playhead = useStudio((s) => s.playhead);
  const focusEdit = useStudio((s) => s.focusEdit);
  const addBacklog = useStudio((s) => s.addBacklog);
  const activeJobId = useStudio((s) => s.activeJobId);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  // a marker clicked on the ruler: bring its item into view
  useEffect(() => {
    if (!focusEdit) return;
    const el = listRef.current?.querySelector(`[data-edit="${focusEdit}"]`);
    el?.scrollIntoView({block: 'center', behavior: 'smooth'});
    const t = setTimeout(() => useStudio.setState({focusEdit: null}), 2400);
    return () => clearTimeout(t);
  }, [focusEdit]);

  if (!project) return null;
  const view = viewScenes(project, sceneId);
  const offsets = sceneOffsets(project);
  // the scene under the playhead takes a new note
  const scene = view.scenes.find((s) => {
    const off = offsets.get(s.id) ?? 0;
    return playhead >= off && playhead < off + s.duration;
  });
  const items = view.scenes
    .flatMap((s) => s.backlog.map((b) => ({s, b, t: (offsets.get(s.id) ?? 0) + b.at})))
    .sort((x, y) => x.t - y.t);

  const add = () => {
    if (!text.trim() || !scene) return;
    addBacklog(scene.id, {kind: 'comment', at: snapToFrame(playhead - (offsets.get(scene.id) ?? 0), project.fps), text: text.trim()});
    setText('');
  };

  const recalc = async () => {
    setError('');
    try {
      const {jobId} = await api.recalc(project.id, sceneId);
      const st = useStudio.getState();
      st.setActiveJob(jobId);
      st.setPanelTab('chat');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="backlog scroll-y" ref={listRef}>
      <div className="bl-item add">
        <span className="when">{sec2(playhead)} с</span>
        <textarea
          rows={1}
          value={text}
          placeholder="Правка к кадру под плейхедом — поставьте его кликом по линейке или карточке (Enter — добавить)"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              add();
            }
          }}
        />
        <button className="chip no-end" onClick={add} disabled={!text.trim() || !scene}>
          Добавить
        </button>
      </div>

      {items.length === 0 ? (
        <div className="empty">
          Пока пусто. Правка попадает сюда, когда вы пишете замечание к кадру, нажимаете <span className="kbd">C</span> (шов
          под плейхедом) или <span className="kbd">Delete</span> на действии, выбираете замену эффекта или «Правка к действию»
          в инспекторе. Каждая отмечена на линейке — клик по метке открывает её здесь.
        </div>
      ) : null}

      {items.map(({s, b}) => (
        <EditRow key={b.id} scene={s} item={b} focused={focusEdit === b.id} busy={Boolean(activeJobId)} onError={setError} />
      ))}

      {items.length ? (
        <div className="edits-foot">
          <button className="pill solid" onClick={recalc} disabled={Boolean(activeJobId)}>
            Пересчитать · {items.length}
          </button>
          <span className="panel-hint">агент получит все правки и то, что вы поменяли мышью</span>
        </div>
      ) : null}
      {error ? <div className="form-error">{error}</div> : null}
    </div>
  );
};

const EditRow: React.FC<{scene: Scene; item: BacklogItem; focused: boolean; busy: boolean; onError: (e: string) => void}> = ({
  scene,
  item,
  focused,
  busy,
  onError,
}) => {
  const project = useStudio((s) => s.project);
  const edit = useStudio((s) => s.edit);
  const removeBacklog = useStudio((s) => s.removeBacklog);
  const setPlayhead = useStudio((s) => s.setPlayhead);
  if (!project) return null;
  const off = sceneOffsets(project).get(scene.id) ?? 0;
  const action = scene.actions.find((a) => a.id === item.actionId);

  const toChat = async () => {
    onError('');
    const where = `${sec2(item.at)} с, сцена «${scene.title}»${action ? `, действие «${action.title}» (${action.id})` : ''}`;
    try {
      const {jobId} = await api.chat(project.id, {
        sceneId: scene.id,
        message: `${KIND[item.kind]} (${where}): ${item.text || 'шов — предложи, что здесь сделать'}`,
        playhead: item.at,
        selected: action ? `«${action.title}» (${action.id})` : undefined,
      });
      removeBacklog(scene.id, item.id);
      const st = useStudio.getState();
      st.setActiveJob(jobId);
      st.setPanelTab('chat');
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <div className={`bl-item ${focused ? 'focused' : ''}`} data-edit={item.id}>
      <div className="edit-meta">
        <button className="when" onClick={() => setPlayhead(off + item.at)} title="Перейти к кадру">
          {sec2(off + item.at)} с
        </button>
        <span className={`edit-kind ${item.kind}`}>{KIND[item.kind]}</span>
      </div>
      <div className="edit-body">
        {action ? <div className="edit-action">{action.title}</div> : null}
        <textarea
          rows={1}
          placeholder="Что сделать в этом месте?"
          value={item.text}
          autoFocus={!item.text}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) =>
            edit(
              (p) => {
                const it = p.scenes.find((x) => x.id === scene.id)?.backlog.find((x) => x.id === item.id);
                if (it) it.text = e.target.value;
              },
              {history: false},
            )
          }
        />
      </div>
      <button className="chip no-end" disabled={busy} title={busy ? 'Агент сейчас работает' : 'Отдать агенту сейчас'} onClick={toChat}>
        <IconSend size={14} stroke={1.5} /> В чат
      </button>
      <button className="icon-btn" onClick={() => removeBacklog(scene.id, item.id)} title="Удалить правку">
        <IconTrash size={16} stroke={1.5} />
      </button>
    </div>
  );
};
