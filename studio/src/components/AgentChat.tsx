import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {
  IconArrowBackUp,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCoins,
  IconCopy,
  IconFile,
  IconPaperclip,
  IconPlayerPlay,
  IconPlayerStopFilled,
  IconSend,
  IconX,
} from '@tabler/icons-react';
import {api, type Approval, type Attachment, type ChatMessage, type RunMeta, type TodoItem} from '../api';
import {findAction, sceneOffsets, useStudio} from '../store';
import {duration, sec2, tokenBreakdown, tokenSum, tokens, usd} from '../format';

const EMPTY_DRAFT = {text: '', attachments: [] as Attachment[]};

/** Conversation with the agent (per scene, or the whole project) with live replies and attachments. */
export const AgentChat: React.FC = () => {
  const project = useStudio((s) => s.project);
  const sceneId = useStudio((s) => s.sceneId);
  const activeJobId = useStudio((s) => s.activeJobId);
  const setActiveJob = useStudio((s) => s.setActiveJob);
  const reloadProject = useStudio((s) => s.reloadProject);
  // the job itself is followed at the top of the app (useJobFollow); the chat only draws it
  const job = useStudio((s) => s.job);
  const log = useStudio((s) => s.jobLog);
  const chatVersion = useStudio((s) => s.chatVersion);
  const draft = useStudio((s) => (s.project ? s.chatDrafts[s.project.id] : undefined)) ?? EMPTY_DRAFT;
  const setChatDraft = useStudio((s) => s.setChatDraft);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [scope, setScope] = useState<'scene' | 'project'>('scene');
  const [showTools, setShowTools] = useState(false);
  // uploads live in the store: files can be dropped anywhere in the studio
  const uploading = useStudio((s) => s.uploading);
  const attachFiles = useStudio((s) => s.attachFiles);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const projectId = project?.id;

  // chat history: on open, when a job ends, and every few seconds while the chat is open
  useEffect(() => {
    if (!projectId) return;
    let stop = false;
    const tick = async () => {
      const h = await api.chatHistory(projectId).catch(() => null);
      if (stop || !h) return;
      setMessages(h.messages);
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [projectId, chatVersion]);

  // always keep the newest message in view
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, log.length, job?.status, showTools]);

  // the prompt field grows with its text
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, Math.max(120, window.innerHeight * 0.35))}px`;
  }, [draft.text]);

  const resumable = useStudio((s) => s.resumable);
  if (!project) return null;
  const scene = project.scenes.find((s) => s.id === sceneId) ?? null;
  const shown = scope === 'scene' && scene ? messages.filter((m) => m.sceneId === scene.id || m.sceneId === null) : messages;
  const backlogCount = (scene ? [scene] : project.scenes).reduce((n, s) => n + s.backlog.length, 0);
  const running = Boolean(job && job.status === 'running');
  const liveText = log.filter((l) => l.kind === 'text').map((l) => l.text);
  const tools = log.filter((l) => l.kind !== 'text' && l.kind !== 'todo');
  // the agent's checklist (TodoWrite): the latest version wins
  const todoLine = [...log].reverse().find((l) => l.kind === 'todo');
  const todos = todoLine ? parseTodos(todoLine.text) : [];

  const attach = (files: File[]) => {
    setError('');
    attachFiles(files).catch((e: Error) => setError(e.message));
  };

  const send = async () => {
    const msg = draft.text.trim();
    if (!msg && !draft.attachments.length) return;
    setError('');
    const st = useStudio.getState();
    const sel = findAction(project, st.selected);
    const off = scene ? (sceneOffsets(project).get(scene.id) ?? 0) : 0;
    try {
      const {jobId} = await api.chat(project.id, {
        sceneId: scope === 'scene' && scene ? scene.id : null,
        message: msg,
        playhead: st.playhead - off,
        selected: sel ? `«${sel.action.title}» (${sel.action.id})` : undefined,
        attachments: draft.attachments,
      });
      setChatDraft(project.id, {text: '', attachments: []});
      setActiveJob(jobId);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const recalc = async () => {
    setError('');
    try {
      const {jobId} = await api.recalc(project.id, scene?.id ?? null);
      setActiveJob(jobId);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const resume = async () => {
    if (!project) return;
    try {
      const {jobId} = await api.resume(project.id);
      useStudio.getState().setActiveJob(jobId);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const rollback = async (jobId: string) => {
    if (!confirm('Откатить проект к состоянию до этой правки агента? Текущее состояние останется в «Версиях».')) return;
    await api.rollbackJob(jobId).catch((e: Error) => setError(e.message));
    await reloadProject();
    api.chatHistory(project.id).then((h) => setMessages(h.messages));
  };

  return (
    <div className="chat">
      <div className="chat-scope">
        <button className={`chip no-end ${scope === 'scene' ? 'active' : ''}`} onClick={() => setScope('scene')} disabled={!scene}>
          {scene ? `Сцена «${scene.title}»` : 'Сцена'}
        </button>
        <button className={`chip no-end ${scope === 'project' ? 'active' : ''}`} onClick={() => setScope('project')}>
          Весь проект
        </button>
        <span className="spacer" />
        {backlogCount ? (
          <button className="pill lime" style={{height: 40}} onClick={recalc} disabled={Boolean(activeJobId)}>
            Пересчитать · {backlogCount}
          </button>
        ) : null}
      </div>

      <div className="chat-list scroll-y" ref={listRef}>
        {shown.length === 0 && !running ? (
          <div className="empty">
            Напишите агенту, что изменить: «сделай выезд телефона резче», «добавь сцену с оплатой», «почему карточки дёргаются на
            8-й секунде?». Он видит выбранное действие и положение плейхеда. Прикладывайте картинки, видео и файлы — скрепкой,
            вставкой из буфера или перетаскиванием.
          </div>
        ) : null}
        {shown.map((m) => (
          <Message key={m.id} m={m} onRollback={rollback} onResume={resumable && !running && m.role === 'agent' && m.jobId === resumable.jobId ? resume : undefined} />
        ))}
        {running && job ? (
          <div className="msg agent live">
            {todos.length ? (
              <ul className="todo-list">
                {todos.map((t, i) => (
                  <li key={i} className={t.status}>
                    <span className="todo-mark" />
                    {t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="msg-text">
              {liveText.length ? liveText.join('\n\n') : 'Начинаю работу…'}
              <span className="typing" />
            </div>
            {job.approvals?.map((a) => <ApprovalCard key={a.id} jobId={job.id} a={a} onError={setError} />)}
            <div className="job-bar">
              <span className="job-dot" />
              <span>{job.title}{job.stage ? ` · ${{'preparing-inputs':'исходники','building-poses':'сборка экрана','animating':'анимация','checking':'проверка','waiting-approval':'ждёт утверждения','waiting-inputs':'ждёт исходники','editing':'правка'}[job.stage]}` : ''}</span>
              <span className="job-time">{elapsed(job.startedAt)}</span>
              <button className="job-tools-toggle" onClick={() => setShowTools(!showTools)}>
                {showTools ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />} действия агента · {tools.length}
              </button>
              <span className="spacer" />
              <button className="chip no-end" onClick={() => api.stopJob(job.id)}>
                <IconPlayerStopFilled size={14} /> Остановить
              </button>
            </div>
            {showTools ? (
              <div className="job-log">
                {tools.slice(-120).map((l, i) => (
                  <div key={i} className={`log ${l.kind}`}>
                    {l.text}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="chat-compose">
        {draft.attachments.length || uploading ? (
          <div className="att-row">
            {draft.attachments.map((a) => (
              <span key={a.path} className="att-chip">
                {a.type.startsWith('image/') ? <img src={a.url} alt="" /> : <IconFile size={16} stroke={1.5} />}
                <span>{a.name}</span>
                <button
                  onClick={() => setChatDraft(project.id, {attachments: draft.attachments.filter((x) => x.path !== a.path)})}
                  title="Убрать вложение"
                >
                  <IconX size={13} />
                </button>
              </span>
            ))}
            {uploading ? <span className="att-chip">загружаю {uploading}…</span> : null}
          </div>
        ) : null}
        <div className="chat-input">
          <button className="icon-btn attach" onClick={() => fileRef.current?.click()} title="Приложить файлы">
            <IconPaperclip size={18} stroke={1.5} />
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              attach([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
          <textarea
            ref={inputRef}
            rows={2}
            value={draft.text}
            placeholder={`Сообщение агенту${scene && scope === 'scene' ? ` · сцена «${scene.title}»` : ' · весь проект'} · плейхед ${sec2(useStudio.getState().playhead)} с · Ctrl+Enter — отправить`}
            onChange={(e) => setChatDraft(project.id, {text: e.target.value})}
            onPaste={(e) => {
              const files = [...e.clipboardData.files];
              if (files.length) {
                e.preventDefault();
                attach(files);
              }
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
            }}
          />
          <button
            className="pill solid"
            style={{height: 48}}
            onClick={send}
            disabled={(!draft.text.trim() && !draft.attachments.length) || Boolean(activeJobId) || uploading > 0}
          >
            <IconSend size={16} stroke={1.5} /> Отправить
          </button>
        </div>
        {activeJobId ? <div className="chat-note">Агент работает — новое сообщение можно будет отправить, когда он закончит. Черновик сохранится.</div> : null}
      </div>
      {error ? <div className="form-error" style={{margin: '0 26px 10px 52px'}}>{error}</div> : null}
    </div>
  );
};

const Message: React.FC<{m: ChatMessage; onRollback: (jobId: string) => void; onResume?: () => void}> = ({m, onRollback, onResume}) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(m.text).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className={`msg ${m.role}`}>
      <div className="msg-text">{m.text}</div>
      {m.attachments?.length ? (
        <div className="msg-atts">
          {m.attachments.map((a) =>
            a.type.startsWith('image/') ? (
              <a key={a.path} href={a.url} target="_blank" rel="noreferrer">
                <img src={a.url} alt={a.name} />
              </a>
            ) : a.type.startsWith('video/') ? (
              <video key={a.path} src={a.url} muted controls preload="metadata" />
            ) : (
              <a key={a.path} className="att-chip" href={a.url} target="_blank" rel="noreferrer">
                <IconFile size={16} stroke={1.5} />
                <span>{a.name}</span>
              </a>
            ),
          )}
        </div>
      ) : null}
      {m.poses?.length ? <PoseSheet m={m} /> : null}
      <div className="msg-meta">
        {new Date(m.at).toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'})}
        {m.meta ? (
          <span className="msg-run" title={runTitle(m.meta)}>
            {runText(m.meta)}
          </span>
        ) : null}
        <button className="msg-btn" onClick={copy} title="Скопировать текст">
          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />} {copied ? 'скопировано' : 'копировать'}
        </button>
        {onResume ? (
          <button className="msg-btn resume" onClick={onResume} title="Запустить остановленную задачу снова — агент продолжит с того места">
            <IconPlayerPlay size={14} /> запустить снова
          </button>
        ) : null}
        {m.role === 'agent' && m.jobId && !/^Откатил/.test(m.text) ? (
          <button className="msg-btn" onClick={() => onRollback(m.jobId!)} title="Вернуть проект к состоянию до этой правки">
            <IconArrowBackUp size={14} /> откатить
          </button>
        ) : null}
      </div>
    </div>
  );
};

/**
 * Contact sheet of key poses (the first creation run): approve them all and the agent
 * animates; or note what to fix on single stills and the poses are re-rendered.
 */
const PoseSheet: React.FC<{m: ChatMessage}> = ({m}) => {
  const project = useStudio((s) => s.project);
  const activeJobId = useStudio((s) => s.activeJobId);
  const setActiveJob = useStudio((s) => s.setActiveJob);
  const bumpChat = useStudio((s) => s.bumpChat);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [general, setGeneral] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const poses = m.poses ?? [];
  const answered = m.posesState;
  const noted = poses.filter((p) => notes[p.file]?.trim());
  const hasNotes = noted.length > 0 || Boolean(general.trim());

  const answer = async (approve: boolean) => {
    if (!project) return;
    setBusy(true);
    setError('');
    try {
      const {jobId} = await api.answerPoses(project.id, {
        messageId: m.id,
        approve,
        notes: noted.map((p) => ({title: p.title ?? p.file, text: notes[p.file]})),
        general,
      });
      setActiveJob(jobId);
      bumpChat();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="poses">
      <div className="poses-grid">
        {poses.map((p) => (
          <div key={p.file} className={`pose ${notes[p.file]?.trim() ? 'noted' : ''}`}>
            <a href={p.url} target="_blank" rel="noreferrer">
              <img src={p.url} alt={p.title ?? p.file} loading="lazy" />
            </a>
            <div className="pose-title">
              <span>{p.title ?? p.file}</span>
              {!answered ? (
                <button className="msg-btn" onClick={() => setOpen({...open, [p.file]: !open[p.file]})}>
                  {open[p.file] ? 'скрыть' : 'Поправить'}
                </button>
              ) : null}
            </div>
            {!answered && open[p.file] ? (
              <textarea
                rows={2}
                autoFocus
                value={notes[p.file] ?? ''}
                placeholder="Что поменять в этом кадре"
                onChange={(e) => setNotes({...notes, [p.file]: e.target.value})}
                onKeyDown={(e) => e.stopPropagation()}
              />
            ) : null}
          </div>
        ))}
      </div>
      {answered ? (
        <div className="poses-state">{answered === 'approved' ? 'Позы утверждены — анимация запущена' : 'Отправлено на правку'}</div>
      ) : (
        <>
          <textarea
            className="poses-general"
            rows={2}
            value={general}
            placeholder="Общее замечание ко всем позам (по желанию)"
            onChange={(e) => setGeneral(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <div className="poses-actions">
            <button className="pill solid" style={{height: 44}} disabled={busy || Boolean(activeJobId)} onClick={() => answer(true)}>
              <IconCheck size={16} /> {hasNotes ? 'Утвердить с замечаниями' : 'Утвердить и анимировать'}
            </button>
            <button className="pill" style={{height: 44}} disabled={busy || !hasNotes || Boolean(activeJobId)} onClick={() => answer(false)}>
              Поправить позы{noted.length ? ` · ${noted.length}` : ''}
            </button>
          </div>
        </>
      )}
      {error ? <div className="form-error">{error}</div> : null}
    </div>
  );
};

/** a paid Magnific call: what, model, the estimate; the agent waits for the answer */
const ApprovalCard: React.FC<{jobId: string; a: Approval; onError: (e: string) => void}> = ({jobId, a, onError}) => {
  const [busy, setBusy] = useState(false);
  const answer = async (allow: boolean) => {
    setBusy(true);
    await api.approve(jobId, a.id, allow).catch((e: Error) => onError(e.message));
    setBusy(false);
  };
  return (
    <div className={`approval ${a.status}`}>
      <div className="approval-head">
        <IconCoins size={16} stroke={1.5} />
        <b>Платный вызов Magnific</b>
        <span className="approval-tool">{a.tool}</span>
      </div>
      <div className="approval-what">{a.what}</div>
      <div className="approval-meta">
        {a.model ? <span>Модель: {a.model}</span> : null}
        <span>{a.estimate ? `Оценка: ${a.estimate}` : 'Оценки нет — агент не запросил цену заранее'}</span>
      </div>
      {a.params ? (
        <details className="approval-params">
          <summary>параметры вызова</summary>
          <code>{a.params}</code>
        </details>
      ) : null}
      {a.status === 'pending' ? (
        <div className="approval-actions">
          <button className="pill solid" style={{height: 40}} disabled={busy} onClick={() => answer(true)}>
            <IconCheck size={16} /> Разрешить
          </button>
          <button className="pill" style={{height: 40}} disabled={busy} onClick={() => answer(false)}>
            <IconX size={16} /> Отклонить
          </button>
          <small>Агент ждёт ответа; без ответа за 15 минут — отказ.</small>
        </div>
      ) : (
        <div className="approval-done">{a.status === 'allowed' ? 'Разрешено' : 'Отклонено'}</div>
      )}
    </div>
  );
};

const elapsed = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const parseTodos = (text: string): TodoItem[] => {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? (v as TodoItem[]).filter((t) => t && typeof t.content === 'string') : [];
  } catch {
    return [];
  }
};

/** «4 мин 12 с · $0,86 · 37 шаг. · 1,2 млн ток. · opus» */
const runText = (m: RunMeta) => {
  const parts: string[] = [];
  if (m.durationMs != null) parts.push(duration(m.durationMs));
  if (m.costUsd != null) parts.push(usd(m.costUsd));
  if (m.turns) parts.push(`${m.turns} шаг.`);
  if (m.tokens) parts.push(`${tokens(tokenSum(m.tokens))} ток.`);
  if (m.planUse?.fiveHour != null) parts.push(`${String(m.planUse.fiveHour).replace('.', ',')} % окна 5 ч`);
  if (m.model) parts.push(m.model.replace(/^claude-/, '').replace(/-\d.*$/, ''));
  return parts.join(' · ');
};

/** the hover line: model and where the tokens went */
const runTitle = (m: RunMeta) =>
  [
    m.model ? `Модель: ${m.model}` : '',
    m.tokens ? `Токены: ${tokenBreakdown(m.tokens)}` : '',
    m.planUse
      ? `Подписка ${m.planUse.plan ?? ''}: ${m.planUse.fiveHour ?? '?'} % окна 5 часов, ${m.planUse.week ?? '?'} % недельного лимита`
      : '',
    m.costUsd == null && m.tokens ? 'Стоимость неизвестна: прогон остановлен до итога' : '',
  ]
    .filter(Boolean)
    .join('\n') || undefined;
