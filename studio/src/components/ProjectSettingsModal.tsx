import {useEffect, useMemo, useRef, useState} from 'react';
import {IconMusic, IconX} from '@tabler/icons-react';
import {api, type ProjectUsage} from '../api';
import {layersOf, projectSeconds, useStudio} from '../store';
import {duration, plural, sec, tokenBreakdown, tokenSum, tokens, usd} from '../format';
import {Modal} from './Modal';
import {SHADERS} from '../../../runtime/shaders';
import {TrackTrim} from './TrackTrim';
import {connectorLabel, useConnectors} from '../connectors';
import {StyleFields, type StyleValue} from './StyleFields';
import {isVariants, type Background, type ScreenTemplate} from '../../../runtime/manifest';
import {LEVELS, PRESETS, SCREEN_DEFAULT, SCREEN_FORMATS, ScreenFields, screenValueFrom, type ScreenValue} from './ScreenFields';

/** a layer of the scene code that plays its own music (older projects keep the track in code) */
const MUSIC_LAYER = /музык|music|аудио|audio|звук|трек|soundtrack/i;

/** what changed in the template settings that only the agent can carry out — one task for «Пересчитать» */
const screenChanges = (a: ScreenValue, b: ScreenValue) => {
  const out: string[] = [];
  if (b.figmaUrl.trim() && b.figmaUrl.trim() !== a.figmaUrl) out.push(`новый кадр интерфейса ${b.figmaUrl.trim()} — пересобери экран`);
  if (b.endFrameUrl.trim() !== a.endFrameUrl)
    out.push(b.endFrameUrl.trim() ? `конечное состояние ${b.endFrameUrl.trim()} — варианты становятся переходом A→B` : 'end-frame убран — варианты без перехода в конечное состояние');
  if (b.preset !== a.preset) out.push(`пресет ${PRESETS.find((p) => p.id === a.preset)?.label ?? a.preset} → ${PRESETS.find((p) => p.id === b.preset)?.label ?? b.preset}`);
  if (b.intensity !== a.intensity) out.push(`интенсивность ${a.intensity} → ${b.intensity} (${LEVELS[b.intensity - 1]?.title}: ${LEVELS[b.intensity - 1]?.hint})`);
  if (b.variants > a.variants) out.push(`добавь варианты ${a.variants + 1}–${b.variants} (сцены v-${a.variants + 1}…) с новой хореографией`);
  if (b.mockupOn !== a.mockupOn) out.push(b.mockupOn ? 'мокап включён — экран внутри <DeviceMockup>' : 'мокап выключен — экран без телефона, карточкой на фоне');
  if (b.format !== a.format) out.push(`формат ${a.format || 'свой'} → ${b.format} — проверь вёрстку и кадрирование вариантов`);
  if (b.aiVideo !== a.aiVideo) out.push(b.aiVideo ? 'движение — ИИ-видео Magnific вместо кода' : 'движение снова кодом, без ИИ-видео');
  if (b.prompt.trim() !== a.prompt) out.push(`пожелания: ${b.prompt.trim() || '(убраны)'}`);
  return out;
};

/**
 * «Настройки проекта»: the target length, style + ban list and music. Saved into
 * project.json in one step (one undo entry); the agent gets them with every run.
 */
export const ProjectSettingsModal: React.FC<{onToast?: (t: string) => void}> = ({onToast}) => {
  const project = useStudio((s) => s.project);
  const setModal = useStudio((s) => s.setModal);
  const edit = useStudio((s) => s.edit);
  const codeLayers = useStudio((s) => s.codeLayers);
  const musicLayers = codeLayers.filter((n) => MUSIC_LAYER.test(n));
  const st = project?.settings;
  const [style, setStyle] = useState<StyleValue>({style: st?.style ?? 'custom', styleNote: st?.styleNote, bans: st?.bans ?? []});
  const [target, setTarget] = useState(project?.targetSeconds ? String(project.targetSeconds) : '');
  const [music, setMusic] = useState(st?.music);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const status = useConnectors();
  // «Оживление скриншота»: the start settings stay editable after the run
  const variants = project ? isVariants(project) : false;
  const initialScreen = useMemo(() => (project && variants ? screenValueFrom(project) : SCREEN_DEFAULT), []);
  const [sv, setSv] = useState<ScreenValue>(initialScreen);
  const setScreen = (p: Partial<ScreenValue>) => setSv((cur) => ({...cur, ...p}));
  const [saving, setSaving] = useState(false);
  const [usage, setUsage] = useState<ProjectUsage | null>(null);
  useEffect(() => {
    if (project) api.usage(project.id).then(setUsage).catch(() => undefined);
  }, [project?.id]);
  if (!project) return null;

  const close = () => setModal(null);
  const save = async () => {
    const t = Number(target.replace(',', '.'));
    // files first (background picture, mockup), then one manifest edit = one undo step
    let background: Background | undefined;
    let mockup: ScreenTemplate['mockup'] = project.screen?.mockup;
    if (variants && project.screen) {
      setSaving(true);
      setError('');
      try {
        if (sv.bgType === 'image') {
          const file = sv.bgImage ? (await api.uploadBackground(project.id, sv.bgImage)).file : sv.bgFile;
          background = file ? {type: 'image', file, fit: 'cover'} : project.screen.background;
        } else if (sv.bgType === 'fill') background = {type: 'fill', colors: sv.fillColors, angle: sv.angle};
        else background = {type: 'shader', shader: sv.shader, colors: sv.shaderColors, speed: sv.speed, ...(SHADERS[sv.shader]?.zoom ? {zoom: sv.zoom} : {})};
        if (!sv.mockupOn) mockup = undefined;
        else if (sv.mockup !== project.screen.mockup?.material) mockup = await api.setMockup(project.id, sv.mockup);
      } catch (e) {
        setError((e as Error).message);
        setSaving(false);
        return;
      }
    }
    const notes = variants ? screenChanges(initialScreen, sv) : [];
    const musicChanged = (music?.file ?? '') !== (project.settings?.music?.file ?? '');
    edit((p) => {
      if (variants && p.screen && background) {
        p.screen = {
          ...p.screen,
          figmaUrl: sv.figmaUrl.trim() || p.screen.figmaUrl,
          endFrameUrl: sv.endFrameUrl.trim() || undefined,
          background,
          mockup,
          preset: sv.preset,
          intensity: sv.intensity,
          variants: sv.variants,
          aiVideo: sv.aiVideo,
          prompt: sv.prompt.trim() || undefined,
        };
        const fmt = SCREEN_FORMATS.find((f) => f.id === sv.format);
        if (fmt) [p.width, p.height] = fmt.size;
        // fewer variants: the extra ones go now; more: the agent builds them on «Пересчитать»
        if (sv.variants < p.scenes.length) p.scenes = p.scenes.slice(0, Math.max(1, sv.variants));
        if (notes.length) {
          p.scenes[0].backlog.push({
            id: `bl-${Date.now().toString(36)}`,
            kind: 'prompt',
            at: 0,
            text: `Настройки оживления изменены: ${notes.join('; ')}.`,
            createdAt: new Date().toISOString(),
          });
        }
      }
      p.settings = {
        style: style.style,
        bans: style.bans,
        ...(style.styleNote?.trim() ? {styleNote: style.styleNote.trim()} : {}),
        ...(music?.file ? {music: {file: music.file, gain: music.gain ?? 1, ...(music.from ? {from: music.from} : {})}} : {}),
      };
      // the scene code may play its own track: while the project has music from here, that layer stays silent —
      // otherwise the two tracks play on top of each other (and it sounds again when this music is removed)
      if (musicChanged && musicLayers.length) {
        const touched = p.scenes.filter((sc) => layersOf(sc).some((l) => musicLayers.includes(l.name)));
        for (const sc of touched.length ? touched : p.scenes) {
          sc.layers = layersOf(sc);
          for (const name of musicLayers) {
            let l = sc.layers.find((x) => x.name === name);
            if (!l) sc.layers.push((l = {name}));
            l.muted = Boolean(music?.file);
          }
        }
      }
      if (t > 0) p.targetSeconds = Math.round(t * 1000) / 1000;
      else delete p.targetSeconds;
    });
    setSaving(false);
    if (notes.length) onToast?.('Изменения хореографии ушли в «Правки» — нажмите «Пересчитать»');
    close();
  };

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setError('');
    setUploading(true);
    try {
      const {file} = await api.uploadMusic(project.id, f);
      setMusic({file, gain: music?.gain ?? 1});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const NOTES: Record<string, string> = {
    figma: 'коннектор claude.ai — только чтение',
    magnific: 'коннектор claude.ai — платные вызовы только с вашего разрешения в чате',
    higgsfield: 'коннектор claude.ai — платные вызовы только с вашего разрешения в чате',
  };
  const conns = status
    ? (['figma', 'magnific', 'higgsfield'] as const).flatMap((id) => {
        const c = status.connectors.find((x) => x.id === id);
        if (!c && id === 'higgsfield') return [];
        return [{id, name: c?.name ?? (id === 'figma' ? 'Figma' : 'Magnific'), status: c?.status ?? 'missing', note: NOTES[id]}];
      })
    : [];

  return (
    <Modal
      title="Настройки проекта"
      subtitle={variants ? 'Оживление, стиль и музыка. Фон и мокап меняются сразу, хореографию агент перестроит при пересчёте.' : 'Стиль, запреты и музыка уходят агенту при каждом запуске'}
      width={variants ? 720 : 640}
      onClose={close}
    >
      <div className="form">
        {variants ? (
          <>
            <h4 className="form-section">Оживление</h4>
            <ScreenFields value={sv} onChange={setScreen} mode="project" projectId={project.id} />
            <h4 className="form-section">Стиль и музыка</h4>
          </>
        ) : null}
        <div className="form-row">
          <label className="form-field">
            <span>
              Цель по длине <em>секунды</em>
            </span>
            <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder={`сейчас ${sec(projectSeconds(project))}`} inputMode="decimal" />
          </label>
          <div className="form-field">
            <span>
              Формат <em>меняет агент</em>
            </span>
            <div className="readonly-field">
              {project.width}×{project.height} · {project.fps} fps
            </div>
          </div>
        </div>

        <StyleFields value={style} onChange={setStyle} />

        <div className="form-field">
          <span>
            Музыка <em>играет под всем роликом</em>
          </span>
          {music?.file ? (
            <div className="music-row">
              <IconMusic size={18} stroke={1.5} />
              <span className="music-name">{music.file.replace(/^audio\/(music-)?/, '')}</span>
              <button type="button" className="icon-btn" onClick={() => setMusic(undefined)} title="Убрать музыку">
                <IconX size={16} />
              </button>
            </div>
          ) : null}
          {music?.file ? (
            <label className="gain-row">
              Громкость
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={music.gain ?? 1}
                onChange={(e) => setMusic({...music, gain: Number(e.target.value)})}
              />
              <b>{Math.round((music.gain ?? 1) * 100)} %</b>
            </label>
          ) : null}
          {music?.file ? (
            <TrackTrim
              src={`/files/${project.id}/${music.file}`}
              from={music.from ?? 0}
              onChange={(from) => setMusic({...music, from})}
              seconds={projectSeconds(project)}
            />
          ) : null}
          <div style={{display: 'flex', gap: 8}}>
            <button type="button" className="pill" style={{height: 44}} disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? 'Загружаю…' : music?.file ? 'Заменить файл' : 'Выбрать файл'}
            </button>
          </div>
          <input ref={fileRef} type="file" accept="audio/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
          <small>
            {musicLayers.length
              ? `В коде сцены есть своя музыка (слой «${musicLayers.join('», «')}»): пока здесь выбран трек, она будет без звука — дорожки не наложатся.`
              : 'Трек играет под всем роликом поверх звука сцен.'}
          </small>
        </div>

        <div className="form-field">
          <span>Подключения</span>
          {conns.map((c) => (
            <div key={c.id} className={`check ${c.status === 'connected' ? 'ok' : 'bad'}`}>
              <span className="dot" />
              <span>{c.name}</span>
              <small>
                {c.status === 'connected' ? c.note : c.status === 'missing' ? 'не подключён — claude.ai → Настройки → Коннекторы' : connectorLabel(c.status)}
              </small>
            </div>
          ))}
          {!status ? <small>Проверяю подключения…</small> : null}
        </div>

        <div className="form-field">
          <span>
            Расход агента <em>все запуски в этом проекте</em>
          </span>
          {!usage ? (
            <small>Считаю…</small>
          ) : !usage.runs ? (
            <small>Агент в этом проекте ещё не запускался.</small>
          ) : (
            <>
              <div className="readonly-field" title={usage.tokenRuns ? `Токены: ${tokenBreakdown(usage.tokens)}` : undefined}>
                {usage.runs} {plural(usage.runs, 'запуск', 'запуска', 'запусков')} · {duration(usage.durationMs)} · {usd(usage.costUsd)}
                {usage.tokenRuns ? ` · ${tokens(tokenSum(usage.tokens))} токенов` : ''}
              </div>
              <small>
                Стоимость — в ценах API; по подписке списываются лимиты окна в 5 часов и недели, а не деньги. Почти все токены —
                чтение кэша, оно в разы дешевле ответа модели.
                {!usage.tokenRuns
                  ? ' Токены начнут считаться со следующего запуска агента.'
                  : usage.tokenRuns < usage.runs
                    ? ` Токены — по ${usage.tokenRuns} из ${usage.runs} запусков: у ранних их не записывали.`
                    : ''}
              </small>
            </>
          )}
        </div>

        {error ? <div className="form-error">{error}</div> : null}
        <div style={{display: 'flex', gap: 8, justifyContent: 'flex-end'}}>
          <button type="button" className="pill" style={{height: 48}} onClick={close}>
            Отмена
          </button>
          <button type="button" className="pill solid" style={{height: 48}} disabled={uploading || saving} onClick={save}>
            {saving ? 'Сохраняю…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </Modal>
  );
};
