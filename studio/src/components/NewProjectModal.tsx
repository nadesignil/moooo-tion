import {useState} from 'react';
import {IconBrandFigma, IconChevronDown, IconChevronRight, IconDeviceMobile, IconMovie, IconMusic, IconPhoto} from '@tabler/icons-react';
import {api} from '../api';
import {useStudio} from '../store';
import {STYLE_PRESETS, stylePreset} from '../../../runtime/styles';
import {FilePick, MultiPick} from './FilePicks';
import {Modal} from './Modal';
import {SCREEN_DEFAULT, ScreenFields, appendScreen, figmaOk as isFigma, type ScreenValue} from './ScreenFields';
import {StyleFields, type StyleValue} from './StyleFields';
import {TrackTrim} from './TrackTrim';
import {clock} from '../format';

const FORMATS = [
  {id: '16:9', label: '16:9 · 1920×1080'},
  {id: '9:16', label: '9:16 · 1080×1920'},
  {id: '1:1', label: '1:1 · 1080×1080'},
  {id: '4:5', label: '4:5 · 1080×1350'},
];

type BriefFields = {
  title: string;
  figmaUrl: string;
  references: File[];
  music: File | null;
  /** second of the track where the video starts */
  musicFrom: number;
  assets: File[];
  style: StyleValue;
  mood: string;
  hero: string;
  target: string;
  ending: string;
  format: string;
  fps: number;
  /** what the video is about and anything else, in free form */
  comment: string;
  /** assets by link: web addresses or paths on this computer, one per line */
  assetLinks: string;
};

const lines = (v: string) =>
  v
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/**
 * The brief the agent gets, in the four blocks of the technique library:
 * inputs (what there is), direction (how it should feel), structure (what happens), build (format).
 * Empty fields are left out; the user sees this text before the start.
 */
export const buildBrief = (f: BriefFields) => {
  const block = (tag: string, lines: string[]) => {
    const body = lines.filter(Boolean);
    return body.length ? `<${tag}>\n${body.join('\n')}\n</${tag}>` : '';
  };
  const preset = stylePreset(f.style.style);
  const links = lines(f.assetLinks);
  const t = parseFloat(f.target.replace(',', '.'));
  return [
    block('inputs', [
      f.figmaUrl.trim() ? `- Раскадровка: ${f.figmaUrl.trim()}` : '- Раскадровки нет',
      f.references.length ? `- Референсы: ${f.references.map((r) => r.name).join(', ')}` : '',
      f.music ? `- Музыка: ${f.music.name}${f.musicFrom > 0 ? ` — играет с ${clock(f.musicFrom)}` : ''}` : '',
      f.assets.length ? `- Ассеты в корзине (${f.assets.length}): ${f.assets.map((a) => a.name).join(', ')}` : '',
      links.length ? `- Ассеты по ссылкам:\n${links.map((l) => `  - ${l}`).join('\n')}` : '',
    ]),
    block('direction', [
      f.comment.trim() ? `- Описание и комментарии пользователя:\n${f.comment.trim()}` : '',
      preset && preset.id !== 'custom' ? `- Стиль: ${preset.title} — ${preset.note}` : '',
      f.mood.trim() ? `- Настроение и темп: ${f.mood.trim()}` : '',
      f.hero.trim() ? `- Главный объект / акцент: ${f.hero.trim()}` : '',
      f.style.bans.length ? `- Запрещено: ${f.style.bans.join('; ')}` : '',
    ]),
    block('structure', [
      t > 0 ? `- Длительность: ${t} с` : '',
      f.ending.trim() ? `- Финал: ${f.ending.trim()}` : '',
    ]),
    block('build', [
      `- Формат: ${FORMATS.find((x) => x.id === f.format)?.label ?? f.format} · ${f.fps} fps`,
    ]),
  ]
    .filter(Boolean)
    .join('\n\n');
};

/** Only the name is required; the brief is assembled from the fields and shown before the start. */
export const NewProjectModal: React.FC = () => {
  const setModal = useStudio((s) => s.setModal);
  const openProject = useStudio((s) => s.openProject);
  const loadProjects = useStudio((s) => s.loadProjects);
  const setActiveJob = useStudio((s) => s.setActiveJob);
  const setPanelTab = useStudio((s) => s.setPanelTab);
  const firstPreset = STYLE_PRESETS[0];
  const [f, setF] = useState<BriefFields>({
    title: '',
    figmaUrl: '',
    references: [],
    music: null,
    musicFrom: 0,
    assets: [],
    style: {style: firstPreset.id, bans: [...firstPreset.bans]},
    mood: '',
    hero: '',
    target: '',
    ending: '',
    format: '16:9',
    fps: 60,
    comment: '',
    assetLinks: '',
  });
  // the style follows the references until the user picks one: none → standard, any → «как в референсе»
  const [styleTouched, setStyleTouched] = useState(false);
  const setReferences = (references: File[]) => {
    if (styleTouched) return set({references});
    const auto = stylePreset(references.length ? 'reference' : 'standard') ?? firstPreset;
    set({references, style: {style: auto.id, bans: [...auto.bans]}});
  };
  const setStyle = (style: StyleValue) => {
    setStyleTouched(true);
    set({style});
  };
  const set = (p: Partial<BriefFields>) => setF((cur) => ({...cur, ...p}));
  // the template is the first choice; each has its own fields
  const [template, setTemplate] = useState<'showreel' | 'screen'>('showreel');
  const [sv, setSv] = useState<ScreenValue>(SCREEN_DEFAULT);
  const setScreen = (p: Partial<ScreenValue>) => setSv((cur) => ({...cur, ...p}));
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const figmaOk = !f.figmaUrl || /figma\.com\/(design|file)\//.test(f.figmaUrl);
  const brief = buildBrief(f);

  const screenReady =
    isFigma(sv.figmaUrl) && (!sv.endFrameUrl || isFigma(sv.endFrameUrl)) && (sv.bgType !== 'image' || Boolean(sv.bgImage));
  const ready = Boolean(f.title.trim()) && (template === 'screen' ? screenReady : figmaOk);

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError('');
    const form = new FormData();
    form.set('title', f.title.trim());
    if (template === 'screen') {
      appendScreen(form, sv);
      return send(form);
    }
    if (f.figmaUrl) form.set('figmaUrl', f.figmaUrl.trim());
    form.set('brief', brief);
    const t = parseFloat(f.target.replace(',', '.'));
    if (t > 0) form.set('targetSeconds', String(t));
    form.set('style', f.style.style);
    form.set('bans', JSON.stringify(f.style.bans));
    for (const l of lines(f.assetLinks)) form.append('assetLink', l);
    form.set('format', f.format);
    form.set('fps', String(f.fps));
    for (const r of f.references) form.append('reference', r);
    if (f.music) form.set('music', f.music);
    if (f.music && f.musicFrom > 0) form.set('musicFrom', String(f.musicFrom));
    for (const a of f.assets) form.append('asset', a);
    return send(form);
  };

  const send = async (form: FormData) => {
    try {
      const {projectId, jobId} = await api.createProject(form);
      await loadProjects();
      await openProject(projectId);
      setActiveJob(jobId);
      setPanelTab('chat');
      setModal(null);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Новый проект"
      subtitle={
        template === 'screen'
          ? 'Один экран из Figma → несколько коротких вариантов анимации, 2–5 с.'
          : 'Достаточно названия. Остальное — по желанию: агент соберёт ролик сам.'
      }
      width={680}
      onClose={() => setModal(null)}
    >
      <div className="form">
        <div className="template-row">
          {(
            [
              ['showreel', <IconMovie key="i" size={20} stroke={1.5} />, 'Шоурил', 'сборка ролика по раскадровке — самый глубокий'],
              [
                'screen',
                <IconDeviceMobile key="i" size={20} stroke={1.5} />,
                'Оживление скриншота',
                'экран из Figma → 1–4 варианта по 2–5 с',
              ],
            ] as const
          ).map(([id, icon, title, hint]) => (
            <button key={id} type="button" className={`template-card ${template === id ? 'active' : ''}`} onClick={() => setTemplate(id)}>
              {icon}
              <b>{title}</b>
              <small>{hint}</small>
            </button>
          ))}
        </div>
        <label className="form-field">
          <span>Название</span>
          <input autoFocus value={f.title} onChange={(e) => set({title: e.target.value})} placeholder="например, Motion-Reel" />
        </label>

        {template === 'screen' ? (
          <ScreenFields value={sv} onChange={setScreen} />
        ) : (
          <>
            <h4 className="form-section">Вводные</h4>
            <label className="form-field">
              <span>
                <IconBrandFigma size={15} stroke={1.5} /> Раскадровка в Figma <em>по желанию</em>
              </span>
              <input
                value={f.figmaUrl}
                onChange={(e) => set({figmaUrl: e.target.value})}
                placeholder="https://www.figma.com/design/…?node-id=…"
              />
              {!figmaOk ? <small className="bad">Нужна ссылка на файл Figma (figma.com/design/…)</small> : null}
              <small>Ссылка на секцию или кадр с раскадровкой. Подписи на кадрах агент прочитает как сценарий.</small>
            </label>
            <div className="form-row">
              <MultiPick
                icon={<IconMovie size={16} stroke={1.5} />}
                label="Референсы"
                hint="видео или картинки, можно несколько"
                accept="video/*,image/*"
                files={f.references}
                onFiles={setReferences}
              />
              <FilePick
                icon={<IconMusic size={16} stroke={1.5} />}
                label="Музыка"
                accept="audio/*"
                file={f.music}
                onFile={(music) => set({music, musicFrom: 0})}
              />
            </div>
            {f.music ? <TrackTrim src={f.music} from={f.musicFrom} onChange={(musicFrom) => set({musicFrom})} seconds={parseFloat(f.target.replace(',', '.')) || undefined} /> : null}
            <label className="form-field">
              <span>
                Описание и комментарии <em>свободно, по желанию</em>
              </span>
              <textarea
                rows={3}
                value={f.comment}
                onChange={(e) => set({comment: e.target.value})}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="О чём ролик, что важно показать, настроение, финал, шрифт из макета, без звука…"
              />
            </label>

            <button type="button" className="form-more spoiler" onClick={() => setMore(!more)}>
              {more ? <IconChevronDown size={15} /> : <IconChevronRight size={15} />} Расширенные настройки
              <small>стиль, запреты, длительность, ассеты, акцент, финал, сборка, бриф</small>
            </button>
            {more ? (
              <div className="form-advanced">
                <StyleFields part="style" value={f.style} onChange={setStyle} />
                <StyleFields part="bans" value={f.style} onChange={setStyle} />
                <label className="form-field">
                  <span>
                    Длительность, с <em>по желанию</em>
                  </span>
                  <input
                    value={f.target}
                    inputMode="decimal"
                    onChange={(e) => set({target: e.target.value})}
                    placeholder="например, 15"
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                  <small>
                    Агент уложит ролик в ±2 с. Пусто — посчитает сам: возьмёт из референса число действий на удар музыки и
                    пересчитает под темп вашего трека.
                  </small>
                </label>
                <MultiPick
                  icon={<IconPhoto size={16} stroke={1.5} />}
                  label="Ассеты"
                  hint="логотип, мокапы, фото, шрифты — лягут в корзину проекта"
                  accept=""
                  files={f.assets}
                  onFiles={(assets) => set({assets})}
                />
                <label className="form-field">
                  <span>
                    Ассеты по ссылке <em>строка — ссылка или путь</em>
                  </span>
                  <textarea
                    rows={2}
                    value={f.assetLinks}
                    onChange={(e) => set({assetLinks: e.target.value})}
                    onKeyDown={(e) => e.stopPropagation()}
                    placeholder={'C:\\Users\\…\\Ассеты\nhttps://drive.google.com/…'}
                  />
                  <small>
                    Папки и файлы с этого компьютера студия сразу скопирует в корзину проекта. Веб-ссылки агент откроет сам и
                    скачает нужное.
                  </small>
                </label>
                <div className="form-row">
                  <label className="form-field">
                    <span>
                      Настроение и темп <em>по желанию</em>
                    </span>
                    <input
                      value={f.mood}
                      onChange={(e) => set({mood: e.target.value})}
                      placeholder="спокойно, дорого; быстрые склейки в конце"
                    />
                  </label>
                  <label className="form-field">
                    <span>
                      Главный акцент <em>по желанию</em>
                    </span>
                    <input value={f.hero} onChange={(e) => set({hero: e.target.value})} placeholder="кнопка «Добавить», карточка соуса" />
                  </label>
                </div>
                <label className="form-field">
                  <span>
                    Финал <em>по желанию</em>
                  </span>
                  <input value={f.ending} onChange={(e) => set({ending: e.target.value})} placeholder="логотип и слоган, экран оплаты…" />
                </label>
                <div className="form-field">
                  <span>Сборка</span>
                  <div className="chip-row">
                    {FORMATS.map((x) => (
                      <button
                        key={x.id}
                        type="button"
                        className={`chip no-end ${f.format === x.id ? 'active' : ''}`}
                        onClick={() => set({format: x.id})}
                      >
                        {x.label}
                      </button>
                    ))}
                    {[60, 30].map((n) => (
                      <button key={n} type="button" className={`chip no-end ${f.fps === n ? 'active' : ''}`} onClick={() => set({fps: n})}>
                        {n} fps
                      </button>
                    ))}
                  </div>
                </div>
                <div className="form-field">
                  <span>Собранный бриф — так его увидит агент</span>
                  <pre className="brief-preview">{brief}</pre>
                </div>
              </div>
            ) : null}
          </>
        )}

        {error ? <div className="form-error">{error}</div> : null}

        <button className="pill solid" disabled={!ready || busy} onClick={submit}>
          {busy
            ? 'Загружаю вводные…'
            : template === 'screen'
              ? `Создать — ${sv.variants} ${sv.variants === 1 ? 'вариант' : 'варианта'}`
              : 'Создать — агент начнёт сборку'}
        </button>
        <p className="form-note">
          {template === 'screen'
            ? 'Агент разберёт кадр на слои, разделит элементы на три уровня и соберёт варианты с разной хореографией. Переключать их — чипами над таймлайном.'
            : 'Агент разберёт раскадровку и референсы, соберёт сцены и разложит каждое движение на карточки таймлайна. Ход работы виден во вкладке «Чат». Обычно это занимает 10–30 минут.'}
        </p>
      </div>
    </Modal>
  );
};
