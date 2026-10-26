import {useEffect, useState} from 'react';
import {IconKeyboard, IconPlus, IconTarget} from '@tabler/icons-react';
import {isVariants} from '../../../runtime/manifest';
import {projectSeconds, sceneOffsets, useStudio} from '../store';
import {sec} from '../format';

export const SceneBar: React.FC = () => {
  const project = useStudio((s) => s.project);
  const sceneId = useStudio((s) => s.sceneId);
  const setScene = useStudio((s) => s.setScene);
  const scaleScene = useStudio((s) => s.scaleScene);
  const setTargetSeconds = useStudio((s) => s.setTargetSeconds);
  // «Оживление скриншота»: the chips switch between variants, there is no «whole project»
  const variants = project ? isVariants(project) : false;
  useEffect(() => {
    if (project && variants && (!sceneId || !project.scenes.some((s) => s.id === sceneId))) {
      setScene(project.scenes[0].id);
      useStudio.getState().setPlayhead(0);
    }
  }, [project, variants, sceneId, setScene]);

  if (!project) return null;
  const scene = project.scenes.find((s) => s.id === sceneId);
  const st = useStudio.getState();
  const total = projectSeconds(project);
  const length = scene ? scene.duration : total;
  const target = project.targetSeconds;
  const delta = target ? total - target : 0;

  const newScene = () => {
    // a new scene is built by the agent: put a task at the end of the last scene
    const last = project.scenes[project.scenes.length - 1];
    st.addBacklog(
      last.id,
      variants
        ? {kind: 'prompt', at: last.duration, text: 'Ещё один вариант с другой хореографией: '}
        : {kind: 'prompt', at: last.duration, text: 'Новая сцена после «' + last.title + '»: '},
    );
    st.setPanelTab('edits');
  };

  // the big number is a lever: typing or dragging a new length stretches every timing in it
  const setLength = (v: number) => {
    if (!(v > 0.1)) return;
    scaleScene(scene ? scene.id : null, v / length);
  };

  return (
    <>
      <div className="scene-bar">
        {variants ? null : (
          <button className={`chip no-end ${sceneId === null ? 'active' : ''}`} onClick={() => setScene(null)}>
            Весь проект
          </button>
        )}
        {project.scenes.map((s) => (
          <button
            key={s.id}
            className={`chip no-end ${sceneId === s.id ? 'active' : ''}`}
            onClick={() => {
              setScene(s.id);
              st.setPlayhead(sceneOffsets(project).get(s.id) ?? 0);
            }}
          >
            {s.title}
          </button>
        ))}
        <button
          className="chip icon outline"
          title={variants ? 'Ещё вариант — опишите идею, агент соберёт при пересчёте' : 'Новая сцена — опишите её, агент соберёт при пересчёте'}
          onClick={newScene}
        >
          <IconPlus size={17} stroke={1.5} />
        </button>
        <button className="chip icon outline help" title="Управление и горячие клавиши (?)" onClick={() => st.setModal('shortcuts')}>
          <IconKeyboard size={17} stroke={1.5} />
        </button>
      </div>
      <div className="scene-title">
        <BigNum value={length} onChange={setLength} title={scene ? 'Длина сцены: потяните или введите — все движения растянутся пропорционально' : 'Длина ролика: потяните или введите — все сцены растянутся пропорционально'} />
        <small>сек.</small>
        <span>{scene ? scene.title : 'Весь проект'}</span>
        {!scene ? (
          <TargetChip
            target={target}
            delta={delta}
            onSet={setTargetSeconds}
            onFit={() => target && scaleScene(null, target / total)}
          />
        ) : null}
      </div>
    </>
  );
};

/** The big seconds figure: drag horizontally to scrub (0,1 с per 4 px), click to type. */
const BigNum: React.FC<{value: number; onChange: (v: number) => void; title: string}> = ({value, onChange, title}) => {
  const [text, setText] = useState<string | null>(null);
  const checkpoint = useStudio((s) => s.checkpoint);
  const shown = text ?? sec(value).replace(' с', '');

  const down = (e: React.PointerEvent) => {
    if (text !== null) return;
    const x0 = e.clientX;
    const v0 = value;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < 3) return;
      if (!moved) {
        moved = true;
        checkpoint();
      }
      onChange(Math.max(0.2, v0 + Math.round(dx / 4) * (ev.shiftKey ? 1 : 0.1)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) setText(shown);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (text !== null) {
    return (
      <input
        className="bignum"
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setText(null);
        }}
        onBlur={() => {
          const v = parseFloat((text ?? '').replace(',', '.'));
          if (!Number.isNaN(v) && Math.abs(v - value) > 1e-6) {
            checkpoint();
            onChange(v);
          }
          setText(null);
        }}
      />
    );
  }
  return (
    <b className="bignum" onPointerDown={down} title={title}>
      {shown}
    </b>
  );
};

/** Target length of the whole film and how far the cut is from it. */
const TargetChip: React.FC<{target?: number; delta: number; onSet: (v: number | undefined) => void; onFit: () => void}> = ({
  target,
  delta,
  onSet,
  onFit,
}) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const off = Math.abs(delta) > 0.5;
  if (editing) {
    return (
      <input
        className="target-input"
        autoFocus
        placeholder="цель, с"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEditing(false);
        }}
        onBlur={() => {
          const v = parseFloat(text.replace(',', '.'));
          onSet(Number.isNaN(v) || v <= 0 ? undefined : v);
          setEditing(false);
        }}
      />
    );
  }
  return (
    <span className="target">
      <button
        className={`target-chip ${target ? (off ? 'warn' : 'ok') : ''}`}
        title={target ? 'Целевая длительность — клик, чтобы изменить (пусто — убрать)' : 'Задать целевую длительность ролика'}
        onClick={() => {
          setText(target ? String(target).replace('.', ',') : '');
          setEditing(true);
        }}
      >
        <IconTarget size={14} stroke={1.5} />
        {target ? `цель ${sec(target)}${off ? ` · ${delta > 0 ? '+' : '−'}${sec(Math.abs(delta))}` : ' · в цели'}` : 'цель'}
      </button>
      {target && off ? (
        <button className="target-chip fit" onClick={onFit} title="Растянуть или сжать все сцены пропорционально до цели">
          Подогнать
        </button>
      ) : null}
    </span>
  );
};
