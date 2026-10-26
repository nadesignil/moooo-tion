import {useEffect, useMemo, useState} from 'react';
import {IconAdjustmentsHorizontal, IconChevronLeft, IconChevronRight, IconClock, IconDownload, IconEye, IconHistory} from '@tabler/icons-react';
import {api, type RenderJob, type Version} from '../api';
import {isVariants} from '../../../runtime/manifest';
import {projectSeconds, useStudio} from '../store';
import {sec} from '../format';

export const Header: React.FC<{onToast: (t: string) => void}> = ({onToast}) => {
  const project = useStudio((s) => s.project);
  const save = useStudio((s) => s.save);
  const previewOpen = useStudio((s) => s.previewOpen);
  const setPreviewOpen = useStudio((s) => s.setPreviewOpen);
  const undo = useStudio((s) => s.undo);
  const redo = useStudio((s) => s.redo);
  const canUndo = useStudio((s) => s.past.length > 0);
  const canRedo = useStudio((s) => s.future.length > 0);
  const codeVersion = useStudio((s) => s.codeVersion);
  const activeJobId = useStudio((s) => s.activeJobId);
  const sceneId = useStudio((s) => s.sceneId);
  const resumable = useStudio((s) => s.resumable);
  const [job, setJob] = useState<RenderJob | null>(null);
  /** what exactly was sent to the renderer */
  const [renderedSig, setRenderedSig] = useState<string | null>(null);

  // everything that changes the picture; the backlog does not
  const sig = useMemo(() => {
    if (!project) return '';
    const scenes = project.scenes.map(({backlog: _backlog, ...scene}) => scene);
    return `${codeVersion}|${project.fps}|${project.width}x${project.height}|${JSON.stringify(scenes)}`;
  }, [project, codeVersion]);

  useEffect(() => {
    if (!project || !job || job.status === 'done' || job.status === 'error') return;
    const id = setInterval(async () => setJob(await api.renderStatus(project.id)), 800);
    return () => clearInterval(id);
  }, [project, job]);

  if (!project) return <header className="header" />;
  const backlog = project.scenes.reduce((n, s) => n + s.backlog.length, 0);
  const st = useStudio.getState();

  const recalc = async () => {
    if (!backlog) {
      // nothing to send, but the last run was stopped: run it again
      if (resumable && !activeJobId) {
        try {
          const {jobId} = await api.resume(project.id);
          st.setActiveJob(jobId);
        } catch (e) {
          onToast((e as Error).message);
        }
      }
      st.setPanelTab('chat');
      return;
    }
    try {
      const {jobId} = await api.recalc(project.id, st.sceneId);
      st.setActiveJob(jobId);
      st.setPanelTab('chat');
    } catch (e) {
      onToast((e as Error).message);
      st.setPanelTab('edits');
    }
  };

  // «Рендер» is always the main action; the finished video gets its own button
  // and only while nothing has changed since the render started
  const ownJob = job && job.projectId === project.id ? job : null;
  const busy = ownJob?.status === 'bundling' || ownJob?.status === 'rendering';
  // «Оживление скриншота»: every variant is its own video — the render takes the variant on screen
  const variants = isVariants(project);
  const variantId = variants ? (sceneId ?? project.scenes[0].id) : undefined;
  const variantTitle = variants ? project.scenes.find((s) => s.id === variantId)?.title : undefined;
  // the length that the target is about: the whole film, or one variant
  const length = variants ? (project.scenes.find((s) => s.id === variantId)?.duration ?? 0) : projectSeconds(project);
  const fresh =
    ownJob?.status === 'done' && ownJob.url && renderedSig === sig && !activeJobId && ownJob.sceneId === variantId ? ownJob : null;

  const render = async () => {
    if (busy) return;
    try {
      setRenderedSig(sig);
      setJob(await api.startRender(project.id, variantId));
    } catch (e) {
      onToast(`Рендер не запустился: ${(e as Error).message}`);
    }
  };

  const renderLabel = !busy
    ? variants
      ? 'Рендер варианта'
      : 'Рендер'
    : ownJob?.status === 'bundling'
      ? 'Сборка…'
      : `Рендер ${Math.round((ownJob?.progress ?? 0) * 100)} %`;

  return (
    <header className="header">
      <h1 title={project.title} style={{fontSize: titleSize(project.title)}}>
        {project.title}
      </h1>
      <div className="header-stats">
        <span
          className={`stat mark ${project.targetSeconds && Math.abs(length - project.targetSeconds) > 0.5 ? 'warn' : ''}`}
          title={project.targetSeconds ? `Цель ${sec(project.targetSeconds)}${variants ? ' на вариант' : ''}` : undefined}
        >
          <IconClock size={16} stroke={1.5} />
          {sec(length)}
          {project.targetSeconds ? <span style={{opacity: 0.5}}>&nbsp;/ {sec(project.targetSeconds)}</span> : null}
        </span>
        <span className="stat" style={{opacity: 0.55}}>
          {project.fps} fps
        </span>
        {/* autosave takes half a second; only a failure is worth a word */}
        {save === 'error' ? <span className="stat mark warn">не сохранено</span> : null}
      </div>
      <div className="header-actions">
        <div className="undo-pair">
          <button className="pill round" onClick={undo} disabled={!canUndo} title="Отменить (Ctrl+Z)">
            <IconChevronLeft size={17} stroke={1.5} />
          </button>
          <button className="pill round" onClick={redo} disabled={!canRedo} title="Вернуть отменённое (Ctrl+Shift+Z)">
            <IconChevronRight size={17} stroke={1.5} />
          </button>
        </div>
        <Versions onToast={onToast} />
        <button className="pill round" onClick={() => st.setModal('project-settings')} title="Настройки проекта: стиль, запреты, музыка">
          <IconAdjustmentsHorizontal size={18} stroke={1.5} />
        </button>
        <button className={`pill ${previewOpen ? 'active' : ''}`} onClick={() => setPreviewOpen(!previewOpen)} title="Окно превью (Space)">
          <IconEye size={18} stroke={1.5} /> Превью
        </button>
        {/* the recalc is the main action of the loop: it carries the accent while there are edits */}
        <button
          className={`pill ${backlog || (resumable && !activeJobId) ? 'solid' : ''}`}
          onClick={recalc}
          title={
            backlog
              ? 'Отдать правки агенту (вместе с тем, что вы поменяли мышью)'
              : resumable && !activeJobId
                ? `Остановленная задача «${resumable.title}» — запустить её снова, агент продолжит с того места`
                : 'Открыть чат с агентом'
          }
        >
          {backlog ? `Пересчитать · ${backlog}` : resumable && !activeJobId ? 'Запустить снова' : 'Пересчитать'}
        </button>
        {fresh ? (
          <a
            className="pill lime"
            href={`${fresh.url}?download=1&as=${encodeURIComponent(`${project.title}${variantTitle ? ` · ${variantTitle}` : ''}.mp4`)}`}
            download
            title="Скачать готовое видео (mp4)"
          >
            <IconDownload size={16} stroke={1.5} /> Скачать видео
          </a>
        ) : null}
        <button
          className={`pill ${backlog ? '' : 'lime'}`}
          onClick={render}
          disabled={busy}
          title={ownJob?.status === 'error' ? `Прошлый рендер: ${ownJob.error}` : undefined}
        >
          {renderLabel}
        </button>
      </div>
    </header>
  );
};

/** long titles shrink before they would be cut */
const titleSize = (t: string) => {
  const n = t.length;
  return n <= 16 ? 51 : n <= 24 ? 42 : n <= 34 ? 34 : 28;
};

const versionLabel = (message: string) => {
  const m = message.match(/^(до|агент|откат|версия|правка):\s*(.*)$/);
  if (!m) return {kind: 'Версия', text: message};
  const kind =
    m[1] === 'версия' && /сохранено вручную|перед переключением/.test(m[2])
      ? 'Сохранено'
      : ({до: 'До правки агента', агент: 'После правки агента', откат: 'Откат', версия: 'Переключение', правка: 'Ваша правка'}[m[1]] ??
        'Версия');
  return {kind, text: m[2]};
};

/** the line under the kind: the task, and what the version holds or changed */
const versionText = (v: Version) => {
  const {kind, text} = versionLabel(v.message);
  if (kind === 'После правки агента' && v.detail) return {kind, title: text, detail: v.detail};
  if (kind === 'До правки агента') return {kind, title: text, detail: 'Состояние проекта перед этой задачей — к нему можно вернуться'};
  return {kind, title: text, detail: v.detail};
};

const Versions: React.FC<{onToast: (t: string) => void}> = ({onToast}) => {
  const project = useStudio((s) => s.project);
  const reloadProject = useStudio((s) => s.reloadProject);
  const activeJobId = useStudio((s) => s.activeJobId);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Version[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!project) return;
    const res = await api.versions(project.id).catch(() => ({dirty: false, versions: [] as Version[]}));
    setList(res.versions);
    setDirty(res.dirty);
  };

  const pick = async (v: Version) => {
    if (!project || v.current) return;
    const {kind, text} = versionLabel(v.message);
    const when = new Date(v.at).toLocaleString('ru-RU', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'});
    if (!confirm(`Переключить проект на версию «${kind}: ${text}» (${when})?\nТекущее состояние сохранится отдельной версией.`)) return;
    setBusy(true);
    try {
      await api.switchVersion(project.id, v.hash, `${kind}: ${text}`.slice(0, 80));
      await reloadProject();
      await load();
      onToast('Проект переключён на выбранную версию');
    } catch (e) {
      onToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="select">
      <button
        className={`pill round ${open ? 'active' : ''}`}
        onClick={() => {
          setOpen(!open);
          if (!open) load();
        }}
        title="Версии — снимки до и после каждой правки агента"
      >
        <IconHistory size={18} stroke={1.5} />
      </button>
      {open ? (
        <div className="select-menu versions" onMouseLeave={() => setOpen(false)}>
          {!list ? <div className="empty" style={{padding: 12}}>Загружаю…</div> : null}
          {list && dirty ? (
            <div className="v-now">
              <span className="v-main">
                <b>Сейчас</b>
                <span>есть правки после последней версии</span>
              </span>
              <button
                className="chip no-end"
                disabled={busy}
                onClick={async () => {
                  if (!project) return;
                  setBusy(true);
                  await api.saveVersion(project.id).catch((e: Error) => onToast(e.message));
                  await load();
                  setBusy(false);
                }}
              >
                Сохранить как версию
              </button>
            </div>
          ) : null}
          {list && !list.length ? <div className="empty" style={{padding: 12}}>Версий пока нет — они появляются после работы агента.</div> : null}
          {list?.map((v) => {
            const {kind, title, detail} = versionText(v);
            return (
              <button key={v.hash} className={v.current ? 'current' : ''} disabled={busy || Boolean(activeJobId)} onClick={() => pick(v)}>
                <span className="v-main">
                  <b>{kind}</b>
                  <span className="v-title">{title}</span>
                  {detail ? <span className="v-detail">{detail}</span> : null}
                  {v.files ? <span className="v-files">{v.files}</span> : null}
                </span>
                <small>
                  {v.current
                    ? 'сейчас'
                    : new Date(v.at).toLocaleString('ru-RU', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'})}
                </small>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};
