import {useEffect, useMemo, useRef, useState} from 'react';
import {IconBrandFigma, IconMusic, IconPhoto, IconMovie} from '@tabler/icons-react';
import type {Project} from '../../../runtime/manifest';
import {SHADERS, SHADER_IDS, ShaderRenderer} from '../../../runtime/shaders';
import {Checkbox} from './Checkbox';
import {FilePick, MultiPick} from './FilePicks';
import {TrackTrim} from './TrackTrim';

export type ScreenValue = {
  figmaUrl: string;
  endFrameUrl: string;
  bgType: 'shader' | 'fill' | 'image';
  shader: string;
  shaderColors: string[];
  speed: number;
  /** pattern size of dither / dot grid */
  zoom: number;
  fillColors: string[];
  angle: number;
  /** a new picture to upload */
  bgImage: File | null;
  /** the picture already in the project (public/…) */
  bgFile: string;
  format: string;
  preset: string;
  references: File[];
  variants: number;
  seconds: number;
  intensity: number;
  mockupOn: boolean;
  mockup: string;
  aiVideo: boolean;
  prompt: string;
  music: File | null;
  /** second of the track where each variant starts */
  musicFrom: number;
};

export const SCREEN_DEFAULT: ScreenValue = {
  figmaUrl: '',
  endFrameUrl: '',
  bgType: 'shader',
  shader: 'mesh',
  shaderColors: [...SHADERS.mesh.colors],
  speed: 1,
  zoom: 1,
  fillColors: ['#101014', '#2c2c35'],
  angle: 160,
  bgImage: null,
  bgFile: '',
  format: '4:5',
  preset: 'dribbble',
  references: [],
  variants: 3,
  seconds: 4,
  intensity: 2,
  mockupOn: true,
  mockup: 'iphone-17-air',
  aiVideo: false,
  prompt: '',
  music: null,
  musicFrom: 0,
};

export const SCREEN_FORMATS = [
  {id: '1:1', label: '1:1', size: [1080, 1080]},
  {id: '4:5', label: '4:5', size: [1080, 1350]},
  {id: '9:16', label: '9:16 · сториз', size: [1080, 1920]},
  {id: '16:9', label: '16:9', size: [1920, 1080]},
];
export const PRESETS = [
  {id: 'dribbble', label: 'Dribbble', hint: 'пружины, сборка формой, нажатия'},
  {id: 'keynote', label: 'Keynote', hint: 'медленные проезды, крупные планы'},
  {id: 'custom', label: 'Свой', hint: 'по референсу'},
];
export const LEVELS = [
  {n: 1, title: 'Ключевые', hint: 'кнопка, карточки, баннер'},
  {n: 2, title: '+ побочные', hint: 'иконки, заголовки, подписи'},
  {n: 3, title: 'Всё', hint: 'включая каркас: навбар, таб-бар'},
];

export const figmaOk = (url: string) => /figma\.com\/(design|file)\//.test(url);

/** the project's template settings as form values (for «Настройки проекта») */
export const screenValueFrom = (p: Project): ScreenValue => {
  const s = p.screen;
  const bg = s?.background;
  const format = SCREEN_FORMATS.find((f) => f.size[0] === p.width && f.size[1] === p.height)?.id ?? '';
  return {
    ...SCREEN_DEFAULT,
    figmaUrl: s?.figmaUrl ?? '',
    endFrameUrl: s?.endFrameUrl ?? '',
    bgType: bg?.type ?? 'shader',
    ...(bg?.type === 'shader'
      ? {shader: bg.shader, shaderColors: SHADERS[bg.shader]?.colors.map((c, i) => bg.colors?.[i] || c) ?? SCREEN_DEFAULT.shaderColors, speed: bg.speed ?? 1, zoom: bg.zoom ?? 1}
      : {}),
    ...(bg?.type === 'fill' ? {fillColors: bg.colors, angle: bg.angle ?? 160} : {}),
    ...(bg?.type === 'image' ? {bgFile: bg.file} : {}),
    format,
    preset: s?.preset ?? 'dribbble',
    variants: p.scenes.length,
    intensity: s?.intensity ?? 2,
    mockupOn: Boolean(s?.mockup),
    mockup: s?.mockup?.material ?? 'iphone-17-air',
    aiVideo: s?.aiVideo ?? false,
    prompt: s?.prompt ?? '',
  };
};

/** what the server needs from the creation form (FormData fields) */
export const appendScreen = (form: FormData, v: ScreenValue) => {
  form.set('template', 'screen');
  form.set('figmaUrl', v.figmaUrl.trim());
  if (v.endFrameUrl.trim()) form.set('endFrameUrl', v.endFrameUrl.trim());
  form.set('format', v.format);
  form.set('fps', '60');
  form.set('preset', v.preset);
  form.set('variants', String(v.variants));
  form.set('intensity', String(v.intensity));
  form.set('targetSeconds', String(v.seconds));
  if (v.mockupOn && v.mockup) form.set('mockup', v.mockup);
  if (v.aiVideo) form.set('aiVideo', '1');
  if (v.prompt.trim()) form.set('prompt', v.prompt.trim());
  if (v.bgType === 'image' && v.bgImage) form.set('bgImage', v.bgImage);
  else if (v.bgType === 'fill') form.set('background', JSON.stringify({type: 'fill', colors: v.fillColors, angle: v.angle}));
  else form.set('background', JSON.stringify({type: 'shader', shader: v.shader, colors: v.shaderColors, speed: v.speed, ...(SHADERS[v.shader]?.zoom ? {zoom: v.zoom} : {})}));
  for (const r of v.references) form.append('reference', r);
  if (v.music) form.set('music', v.music);
  if (v.music && v.musicFrom > 0) form.set('musicFrom', String(v.musicFrom));
};

// one WebGL context for every thumbnail: draw, copy out as an image, next
let thumbCanvas: HTMLCanvasElement | null = null;
let thumbRenderer: ShaderRenderer | null = null;
const thumbCache = new Map<string, string>();
const shaderThumb = (id: string, colors: string[], w: number, h: number) => {
  const key = `${id}|${colors.join(',')}|${w}x${h}`;
  const hit = thumbCache.get(key);
  if (hit) return hit;
  try {
    thumbCanvas ??= document.createElement('canvas');
    thumbCanvas.width = w;
    thumbCanvas.height = h;
    thumbRenderer ??= new ShaderRenderer(thumbCanvas);
    thumbRenderer.draw(id, {time: 3, width: w, height: h, colors});
    const url = thumbCanvas.toDataURL('image/png');
    thumbCache.set(key, url);
    return url;
  } catch {
    return '';
  }
};

/** the selected shader, moving: one live canvas */
const LiveShader: React.FC<{id: string; colors: string[]; speed: number; zoom: number; w: number; h: number}> = ({id, colors, speed, zoom, w, h}) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let r: ShaderRenderer | null = null;
    try {
      r = new ShaderRenderer(canvas);
    } catch {
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      try {
        r!.draw(id, {time: ((performance.now() - t0) / 1000) * speed, width: w, height: h, colors, zoom});
      } catch (err) {
        console.error('[moootion] shader preview', err);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      r?.dispose();
    };
  }, [id, colors.join(','), speed, zoom, w, h]);
  return <canvas ref={ref} width={w} height={h} className="shader-live" />;
};

export type MockupItem = {
  id: string;
  title: string;
  thumb: string;
  material?: string;
  size?: [number, number];
  screen?: {x: number; y: number; w: number; h: number; r: number};
};

let mockupsCache: Promise<MockupItem[]> | null = null;
const useMockups = () => {
  const [list, setList] = useState<MockupItem[]>([]);
  useEffect(() => {
    mockupsCache ??= fetch('/api/mockups')
      .then((r) => r.json())
      .catch(() => []);
    mockupsCache.then(setList);
  }, []);
  return list;
};

/** CSS background that stands for the chosen video background (behind the mockup preview) */
const backgroundLook = (v: ScreenValue, projectId?: string): React.CSSProperties => {
  if (v.bgType === 'fill') return {background: v.fillColors.length === 1 ? v.fillColors[0] : `linear-gradient(${v.angle}deg, ${v.fillColors.join(', ')})`};
  if (v.bgType === 'image') {
    const url = v.bgImage ? URL.createObjectURL(v.bgImage) : v.bgFile && projectId ? `/files/${projectId}/${v.bgFile}` : '';
    return url ? {backgroundImage: `url(${url})`, backgroundSize: 'cover', backgroundPosition: 'center'} : {background: '#1c1c1f'};
  }
  const url = shaderThumb(v.shader, v.shaderColors, 240, 300);
  return url ? {backgroundImage: `url(${url})`, backgroundSize: 'cover'} : {background: '#1c1c1f'};
};

/** the device large, on the chosen background, with a light screen */
const MockupPreview: React.FC<{item?: MockupItem; look: React.CSSProperties}> = ({item, look}) => {
  if (!item) return <div className="mockup-preview" style={look} />;
  const [w, h] = item.size ?? [1712, 3519];
  const sc = item.screen ?? {x: 67, y: 58, w: 1577, h: 3403, r: 124};
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  return (
    <div className="mockup-preview" style={look}>
      <div className="mockup-device" style={{aspectRatio: `${w} / ${h}`}}>
        <span
          className="mockup-screen"
          style={{left: pct(sc.x, w), top: pct(sc.y, h), width: pct(sc.w, w), height: pct(sc.h, h), borderRadius: `${(sc.r / sc.w) * 100}% / ${(sc.r / sc.h) * 100}%`}}
        />
        <img src={`/library/mockups/${item.id}/device.png`} alt="" />
      </div>
    </div>
  );
};

export const ScreenFields: React.FC<{
  value: ScreenValue;
  onChange: (p: Partial<ScreenValue>) => void;
  /** «create» — the new-project form; «project» — the settings of a made project (no length, music, references) */
  mode?: 'create' | 'project';
  projectId?: string;
}> = ({value: v, onChange: set, mode = 'create', projectId}) => {
  const fmt = SCREEN_FORMATS.find((f) => f.id === v.format) ?? SCREEN_FORMATS[1];
  // thumbnails keep the video's proportions
  const tw = 96;
  const th = Math.round((tw * fmt.size[1]) / fmt.size[0]);
  const thumbs = useMemo(() => Object.fromEntries(SHADER_IDS.map((id) => [id, shaderThumb(id, [...SHADERS[id].colors], tw, th)])), [tw, th]);
  const mockups = useMockups();
  // the big preview follows the cursor over the grid, else the selected one
  const [hoverMockup, setHoverMockup] = useState<string | null>(null);
  const shown = mockups.find((m) => m.id === (hoverMockup ?? v.mockup));
  const look = useMemo(() => backgroundLook(v, projectId), [v.bgType, v.shader, v.shaderColors.join(), v.fillColors.join(), v.angle, v.bgImage, v.bgFile, projectId]);
  const create = mode === 'create';

  const pickShader = (id: string) => set({shader: id, shaderColors: [...SHADERS[id].colors]});

  return (
    <>
      <label className="form-field">
        <span>
          <IconBrandFigma size={15} stroke={1.5} /> Кадр интерфейса в Figma
        </span>
        <input value={v.figmaUrl} onChange={(e) => set({figmaUrl: e.target.value})} placeholder="https://www.figma.com/design/…?node-id=…" />
        {v.figmaUrl && !figmaOk(v.figmaUrl) ? <small className="bad">Нужна ссылка на кадр в Figma (figma.com/design/…?node-id=…)</small> : null}
        <small>
          {create
            ? 'Ссылка на один фрейм экрана: агент возьмёт его слои и оживит настоящие элементы.'
            : 'Новая ссылка — агент пересоберёт экран при «Пересчитать».'}
        </small>
      </label>
      <label className="form-field">
        <span>
          Конечное состояние <em>end-frame, по желанию</em>
        </span>
        <input value={v.endFrameUrl} onChange={(e) => set({endFrameUrl: e.target.value})} placeholder="второй фрейм — ролик станет переходом в него" />
        {v.endFrameUrl && !figmaOk(v.endFrameUrl) ? <small className="bad">Нужна ссылка на кадр в Figma</small> : null}
      </label>

      <div className="form-field">
        <span>Фон {create ? null : <em>меняется сразу, без агента</em>}</span>
        <div className="seg" style={{alignSelf: 'flex-start'}}>
          {(
            [
              ['shader', 'Шейдер'],
              ['fill', 'Заливка'],
              ['image', 'Картинка'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" className={v.bgType === id ? 'on' : ''} onClick={() => set({bgType: id})}>
              {label}
            </button>
          ))}
        </div>
        {v.bgType === 'shader' ? (
          <div className="shader-pick">
            <div className="shader-grid">
              {SHADER_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`shader-cell ${v.shader === id ? 'active' : ''}`}
                  title={`${SHADERS[id].title} — ${SHADERS[id].hint}`}
                  onClick={() => pickShader(id)}
                  style={{aspectRatio: `${tw} / ${th}`, backgroundImage: thumbs[id] ? `url(${thumbs[id]})` : undefined}}
                >
                  <span>{SHADERS[id].title}</span>
                </button>
              ))}
            </div>
            <div className="shader-side">
              <LiveShader id={v.shader} colors={v.shaderColors} speed={v.speed} zoom={SHADERS[v.shader]?.zoom ? v.zoom : 1} w={160} h={Math.round((160 * fmt.size[1]) / fmt.size[0])} />
              <b>{SHADERS[v.shader]?.title}</b>
              <small>{SHADERS[v.shader]?.hint}</small>
              <div className="swatches">
                {v.shaderColors.map((c, i) => (
                  <label key={i} className="swatch" title={['Основа', 'Главный', 'Акцент', 'Ореол'][i]} style={{background: c}}>
                    <input type="color" value={c} onChange={(e) => set({shaderColors: v.shaderColors.map((x, j) => (j === i ? e.target.value : x))})} />
                  </label>
                ))}
                <button type="button" className="link-btn" onClick={() => set({shaderColors: [...SHADERS[v.shader].colors]})}>
                  сбросить
                </button>
              </div>
              <div className="chip-row">
                {[0.5, 1, 2].map((sp) => (
                  <button key={sp} type="button" className={`chip no-end small ${v.speed === sp ? 'active' : ''}`} onClick={() => set({speed: sp})}>
                    {sp === 0.5 ? 'медленно' : sp === 1 ? 'обычно' : 'быстро'}
                  </button>
                ))}
              </div>
              {SHADERS[v.shader]?.zoom ? (
                <label className="gain-row" title="Размер точек и пикселей рисунка">
                  Масштаб
                  <input type="range" min={0.5} max={3} step={0.1} value={v.zoom} onChange={(e) => set({zoom: Number(e.target.value)})} />
                  <b>×{v.zoom.toFixed(1).replace('.', ',')}</b>
                </label>
              ) : null}
            </div>
          </div>
        ) : v.bgType === 'fill' ? (
          <div className="fill-pick">
            <div className="fill-preview" style={look} />
            <div className="swatches">
              {v.fillColors.map((c, i) => (
                <label key={i} className="swatch" style={{background: c}}>
                  <input type="color" value={c} onChange={(e) => set({fillColors: v.fillColors.map((x, j) => (j === i ? e.target.value : x))})} />
                </label>
              ))}
              {v.fillColors.length < 3 ? (
                <button type="button" className="link-btn" onClick={() => set({fillColors: [...v.fillColors, '#7c5cff']})}>
                  + цвет
                </button>
              ) : null}
              {v.fillColors.length > 1 ? (
                <button type="button" className="link-btn" onClick={() => set({fillColors: v.fillColors.slice(0, -1)})}>
                  − цвет
                </button>
              ) : null}
              {v.fillColors.length > 1 ? (
                <label className="angle">
                  угол
                  <input type="number" value={v.angle} onChange={(e) => set({angle: Number(e.target.value) || 0})} onKeyDown={(e) => e.stopPropagation()} />°
                </label>
              ) : null}
            </div>
          </div>
        ) : (
          <FilePick
            icon={<IconPhoto size={16} stroke={1.5} />}
            label={v.bgFile && !v.bgImage ? `Картинка фона · ${v.bgFile.split('/').pop()}` : 'Картинка фона'}
            accept="image/*"
            file={v.bgImage}
            onFile={(bgImage) => set({bgImage})}
          />
        )}
      </div>

      <div className="form-field">
        <span>Формат {create ? null : <em>сразу; вёрстку агент проверит при пересчёте</em>}</span>
        <div className="chip-row">
          {SCREEN_FORMATS.map((f) => (
            <button key={f.id} type="button" className={`chip no-end ${v.format === f.id ? 'active' : ''}`} onClick={() => set({format: f.id})}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <Checkbox
        checked={v.mockupOn}
        onChange={(mockupOn) => set({mockupOn})}
        title="Экран в мокапе телефона"
        hint={create ? 'iPhone 17 Air: стандартный или в одной из 15 рамок.' : 'Смена материала — сразу; включение и выключение агент учтёт при пересчёте.'}
      />
      {v.mockupOn ? (
        <div className="mockup-pick">
          <div className="mockup-grid" onMouseLeave={() => setHoverMockup(null)}>
            {mockups.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`mockup-cell ${v.mockup === m.id ? 'active' : ''}`}
                onClick={() => set({mockup: m.id})}
                onMouseEnter={() => setHoverMockup(m.id)}
                title={m.title}
              >
                <img src={`/library/mockups/${m.thumb}`} alt="" loading="lazy" />
                <span>{m.title}</span>
              </button>
            ))}
            {!mockups.length ? <small>Загружаю мокапы…</small> : null}
          </div>
          <div className="mockup-side">
            <MockupPreview item={shown} look={look} />
            <b>{shown?.title ?? ''}</b>
          </div>
        </div>
      ) : null}

      <div className="form-field">
        <span>Анимация {create ? null : <em>агент перестроит при пересчёте</em>}</span>
        <div className="chip-row">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" className={`chip no-end ${v.preset === p.id ? 'active' : ''}`} onClick={() => set({preset: p.id})} title={p.hint}>
              {p.label}
            </button>
          ))}
        </div>
        {v.preset === 'custom' && create ? (
          <MultiPick
            icon={<IconMovie size={16} stroke={1.5} />}
            label="Референсы"
            hint="видео с нужной механикой"
            accept="video/*,image/*"
            files={v.references}
            onFiles={(references) => set({references})}
          />
        ) : null}
      </div>

      <div className="form-row">
        <div className="form-field">
          <span>Вариантов</span>
          <div className="chip-row">
            {[1, 2, 3, 4].map((n) => (
              <button key={n} type="button" className={`chip no-end ${v.variants === n ? 'active' : ''}`} onClick={() => set({variants: n})}>
                {n}
              </button>
            ))}
          </div>
          <small>{create ? 'Различаются хореографией.' : 'Меньше — лишние уберутся сразу; больше — новые соберёт агент.'}</small>
        </div>
        {create ? (
          <div className="form-field">
            <span>Длина варианта</span>
            <div className="chip-row">
              {[2, 3, 4, 5].map((n) => (
                <button key={n} type="button" className={`chip no-end ${v.seconds === n ? 'active' : ''}`} onClick={() => set({seconds: n})}>
                  {n} с
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="form-field">
        <span>Интенсивность {create ? null : <em>агент перестроит при пересчёте</em>}</span>
        <div className="level-row">
          {LEVELS.map((l) => (
            <button key={l.n} type="button" className={`level-card ${v.intensity === l.n ? 'active' : ''}`} onClick={() => set({intensity: l.n})}>
              <i>
                {Array.from({length: 3}, (_, i) => (
                  <em key={i} className={i < l.n ? 'on' : ''} />
                ))}
              </i>
              <b>{l.title}</b>
              <small>{l.hint}</small>
            </button>
          ))}
        </div>
        <small>Интерфейс делится на три уровня: ключевые элементы, побочные и общий каркас.</small>
      </div>

      <Checkbox
        checked={v.aiVideo}
        onChange={(aiVideo) => set({aiVideo})}
        title="Движение — ИИ-видео (Magnific)"
        hint="Вместо кода экран оживит генерация видео по скриншоту. Платно: агент покажет цену и спросит в чате."
      />

      <label className="form-field">
        <span>
          Пожелания <em>по желанию</em>
        </span>
        <textarea rows={2} value={v.prompt} onChange={(e) => set({prompt: e.target.value})} placeholder="акцент на кнопке «Оплатить», карточки въезжают снизу…" />
      </label>
      {create ? <FilePick icon={<IconMusic size={16} stroke={1.5} />} label="Музыка" accept="audio/*" file={v.music} onFile={(music) => set({music, musicFrom: 0})} /> : null}
      {create && v.music ? <TrackTrim src={v.music} from={v.musicFrom} onChange={(musicFrom) => set({musicFrom})} seconds={v.seconds} /> : null}
    </>
  );
};
