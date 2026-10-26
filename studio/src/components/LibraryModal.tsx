import {useState} from 'react';
import {EFFECTS, ROLE_NAMES, roleOf, type Role} from '../catalog';
import {findAction, useStudio} from '../store';
import {Modal} from './Modal';

/** Effect catalog. With an action selected, an effect can be sent to the agent as a replacement. */
export const LibraryModal: React.FC = () => {
  const setModal = useStudio((s) => s.setModal);
  const project = useStudio((s) => s.project);
  const selected = useStudio((s) => s.selected);
  const addBacklog = useStudio((s) => s.addBacklog);
  const setPanelTab = useStudio((s) => s.setPanelTab);
  const [role, setRole] = useState<Role | 'all'>('all');
  const found = project ? findAction(project, selected) : null;

  // how often each effect is used in the open project
  const usage = new Map<string, number>();
  for (const s of project?.scenes ?? []) for (const a of s.actions) if (a.effect) usage.set(a.effect, (usage.get(a.effect) ?? 0) + 1);

  const list = Object.entries(EFFECTS).filter(([id]) => role === 'all' || roleOf(id) === role);

  return (
    <Modal
      title="Библиотека эффектов"
      subtitle={
        found
          ? `Выбрано: «${found.action.title}». Нажмите на эффект — агент заменит движение при пересчёте.`
          : 'Каталог движений студии. Выберите действие на таймлайне, чтобы предложить замену. Агент может добавить новые.'
      }
      width={760}
      onClose={() => setModal(null)}
    >
      <div className="lib-roles">
        <button className={`chip no-end ${role === 'all' ? 'active' : ''}`} onClick={() => setRole('all')}>
          Все
        </button>
        {(Object.keys(ROLE_NAMES) as Role[]).map((r) => (
          <button key={r} className={`chip no-end ${role === r ? 'active' : ''}`} onClick={() => setRole(r)}>
            {ROLE_NAMES[r]}
          </button>
        ))}
      </div>
      <div className="lib-grid">
        {list.map(([id, e]) => (
          <button
            key={id}
            className={`lib-card ${found?.action.effect === id ? 'current' : ''}`}
            disabled={!found}
            onClick={() => {
              if (!found) return;
              addBacklog(found.scene.id, {
                kind: 'effect',
                at: found.action.start,
                actionId: found.action.id,
                text: `Заменить «${found.action.title}» на «${e.name}» (${id})`,
              });
              setPanelTab('edits');
              setModal(null);
            }}
          >
            <small>{ROLE_NAMES[roleOf(id) as Role]}</small>
            <b>{e.name}</b>
            <span>{e.hint}</span>
            <i>
              {id}
              {usage.get(id) ? ` · в проекте ×${usage.get(id)}` : ''}
            </i>
          </button>
        ))}
      </div>
    </Modal>
  );
};
