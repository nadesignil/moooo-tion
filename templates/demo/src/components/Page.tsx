// S7 main page, built from the Figma design context (Main Top Block, Multi banner,
// «Куда летаем»). Everything is in page units — the camera scales it.
import {Img} from 'remotion';
import {
  BANNER,
  BANNER_TEXT_X,
  BTN,
  DATE,
  DEST,
  FIELDS_Y,
  FIELD_H,
  FILTER_Y,
  FORM,
  HEADER,
  PAGE_W,
  PAX,
  TABS_Y,
  TOP,
  WRAPPER_Y,
} from '../geometry';
import {Layer, asset} from '../moootion';
import {C, Icon, txt} from './ui';

const abs = (x: number, y: number, w?: number, h?: number): React.CSSProperties => ({
  position: 'absolute',
  left: x,
  top: y,
  width: w,
  height: h,
});

// ───────────────────────────── белая шапка с навигацией ─────────────────────────────
export const TopBlockBg: React.FC<{y: number}> = ({y}) => (
  <div
    style={{
      ...abs(0, y, PAGE_W, TOP.h),
      background: '#fff',
      borderBottomLeftRadius: TOP.radius,
      borderBottomRightRadius: TOP.radius,
    }}
  />
);

const NAV = ['Покупка и управление', 'Информация', 'S7 Priority', 'Бизнесу', 'Gate 7'];

export const Header: React.FC<{y: number; opacity: number}> = ({y, opacity}) => (
  <div
    style={{
      ...abs(HEADER.x, HEADER.y + y, HEADER.w, HEADER.h),
      opacity,
      background: '#fff',
      borderRadius: 200,
      boxShadow: C.shadow,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    }}
  >
    <div style={{display: 'flex', alignItems: 'center', gap: 40, paddingLeft: 20}}>
      <Icon name="s7-airlines" size={100} h={32} />
      <div style={{display: 'flex', gap: 6}}>
        {NAV.map((n) => (
          <div key={n} style={{display: 'flex', alignItems: 'center', gap: 2, padding: '0 14px', height: 48}}>
            <span style={txt(14, 500, C.primary)}>{n}</span>
            {n === 'Gate 7' ? <Icon name="gate-arrow" size={16} style={{marginTop: 2}} /> : null}
          </div>
        ))}
      </div>
    </div>
    <div style={{display: 'flex', alignItems: 'center', gap: 4, paddingRight: 16}}>
      {['search', 'message'].map((n) => (
        <div key={n} style={{width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
          <Icon name={n} size={20} />
        </div>
      ))}
      <div style={{padding: '0 16px'}}>
        <span style={txt(14, 500, C.primary2)}>Войти</span>
      </div>
    </div>
  </div>
);

// «Покупка · Регистрация и мои бронирования · Табло рейсов»
export const PageTabs: React.FC<{y: number; opacity: number}> = ({y, opacity}) => (
  <div
    style={{
      ...abs(0, TABS_Y + y, PAGE_W, 38),
      opacity,
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'flex-end',
      gap: 28,
    }}
  >
    <span style={txt(40, 500, C.primary, {lineHeight: '36px', paddingBottom: 2})}>Покупка</span>
    <span style={txt(28, 500, C.tertiary, {lineHeight: '32px', letterSpacing: -0.56})}>Регистрация и мои бронирования</span>
    <span style={txt(28, 500, C.tertiary, {lineHeight: '32px', letterSpacing: -0.56})}>Табло рейсов</span>
  </div>
);

// ───────────────────────────── форма поиска ─────────────────────────────
export type Typing = {
  text: string;
  /** per-letter progress 0..1 */
  letters: number[];
  rise: number;
  blur: number;
  placeholder: number;
};

const Field: React.FC<{x: number; w: number; children: React.ReactNode; style?: React.CSSProperties}> = ({
  x,
  w,
  children,
  style,
}) => (
  <div
    style={{
      ...abs(x - FORM.x, FIELDS_Y - FORM.y, w, FIELD_H),
      background: C.field,
      borderRadius: 200,
      display: 'flex',
      alignItems: 'center',
      ...style,
    }}
  >
    {children}
  </div>
);

export const SearchForm: React.FC<{
  y: number;
  opacity: number;
  /** card shadow + white bg (0 when the calendar zoom takes over) */
  cardOpacity: number;
  typing: Typing;
}> = ({y, opacity, cardOpacity, typing}) => {
  const half = DEST.w / 2;
  return (
    <div style={{...abs(FORM.x, FORM.y + y, FORM.w, FORM.h), opacity}}>
      <div style={{position: 'absolute', inset: 0, background: '#fff', borderRadius: 64, boxShadow: C.shadow, opacity: cardOpacity}} />
      {/* вкладки формы */}
      <div style={{...abs(36, 24, 600, 36), display: 'flex', alignItems: 'flex-end', gap: 20}}>
        <div style={{position: 'relative', height: 28, display: 'flex', alignItems: 'flex-end'}}>
          <span style={txt(24, 500, C.primary, {lineHeight: '28px', letterSpacing: -0.48})}>Авиа</span>
          <div
            style={{position: 'absolute', left: '50%', bottom: -8, width: 12, height: 5, marginLeft: -6, borderRadius: 20, background: C.green}}
          />
        </div>
        {['Отели', 'Экскурсии', 'Трансфер'].map((t) => (
          <div key={t} style={{display: 'flex', alignItems: 'center', gap: 2, height: 28}}>
            <span style={txt(17, 500, C.tertiary, {lineHeight: '24px'})}>{t}</span>
            {t === 'Экскурсии' ? <Icon name="gate-arrow" size={14} style={{opacity: 0.7}} /> : null}
          </div>
        ))}
      </div>
      {/* Москва ⇄ Куда */}
      <Field x={DEST.x} w={DEST.w}>
        <div style={{width: half, display: 'flex', alignItems: 'center', padding: '0 32px 0 24px', boxSizing: 'border-box'}}>
          <span style={txt(17, 400, C.primary2, {flex: 1})}>Москва</span>
          <span style={txt(14, 400, C.tertiary)}>DME</span>
        </div>
        <div style={{width: half, paddingLeft: 32, position: 'relative', height: 24}}>
          {/* block + padding как у родителя: плейсхолдер стоит в той же статической позиции */}
          <Layer name="Поле «Куда»" style={{display: 'block', paddingLeft: 32}}>
          <span style={txt(17, 400, C.placeholder, {position: 'absolute', left: 32, lineHeight: '24px', opacity: typing.placeholder})}>
            Куда
          </span>
          <div style={{position: 'absolute', left: 32, top: 0, display: 'flex', lineHeight: '24px'}}>
            {typing.text.split('').map((ch, i) => {
              const p = typing.letters[i] ?? 0;
              return (
                <span
                  key={i}
                  style={txt(17, 400, C.primary2, {
                    display: 'inline-block',
                    whiteSpace: 'pre',
                    opacity: Math.min(1, p * 1.6),
                    transform: `translateY(${(1 - p) * typing.rise}px)`,
                    filter: p < 1 ? `blur(${(1 - p) * typing.blur}px)` : undefined,
                  })}
                >
                  {ch}
                </span>
              );
            })}
          </div>
          </Layer>
        </div>
        <div
          style={{
            position: 'absolute',
            left: half - 20,
            top: FIELD_H / 2 - 20,
            width: 40,
            height: 40,
            borderRadius: 200,
            background: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="swap" size={16} />
        </div>
      </Field>
      <Field x={DATE.x} w={DATE.w} style={{padding: '0 24px', boxSizing: 'border-box'}}>
        <span style={txt(17, 400, C.placeholder, {flex: 1})}>Когда</span>
        <Icon name="calendar" size={20} />
      </Field>
      <Field x={PAX.x} w={PAX.w} style={{padding: '0 24px', boxSizing: 'border-box'}}>
        <span style={txt(17, 400, C.primary2, {flex: 1})}>1, Эконом</span>
        <Icon name="user" size={20} />
      </Field>
      <Field x={BTN.x} w={BTN.w} style={{background: C.green, justifyContent: 'center'}}>
        <Icon name="search-white" size={24} />
      </Field>
    </div>
  );
};

// «Сложный маршрут · Оплата милями» — white text over the banner
export const FilterRow: React.FC<{y: number; opacity: number}> = ({y, opacity}) => (
  <div
    style={{
      ...abs(FORM.x + 32, FILTER_Y + y, FORM.w - 64, 52),
      opacity,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    }}
  >
    <div style={{display: 'flex', alignItems: 'center', gap: 4}}>
      <Icon name="complex" size={16} />
      <span style={txt(14, 500, '#fff')}>Сложный маршрут</span>
    </div>
    <div style={{display: 'flex', alignItems: 'center', gap: 6}}>
      <Icon name="switcher" size={32} h={20} />
      <span style={txt(14, 500, '#fff')}>Оплата милями</span>
    </div>
  </div>
);

// ───────────────────────────── баннер: текст ─────────────────────────────
export const BannerText: React.FC<{
  title: string[];
  sub: string;
  /** per-line progress: title lines…, sub, button */
  p: number[];
  rise: number;
}> = ({title, sub, p, rise}) => {
  const line = (i: number): React.CSSProperties => {
    const v = p[i] ?? 1;
    return {opacity: v, transform: `translateY(${(1 - v) * rise}px)`};
  };
  const contentTop = BANNER.y + BANNER.h - 200 - 214;
  return (
    <>
      <div style={{...abs(BANNER_TEXT_X, contentTop, 1148, 214)}}>
        {title.map((t, i) => (
          <div key={i} style={{...txt(54, 500, '#fff', {lineHeight: '58px'}), ...line(i)}}>
            {t}
          </div>
        ))}
        <div style={{...txt(19, 400, '#fff', {lineHeight: '28px', marginTop: 10}), ...line(title.length)}}>{sub}</div>
        <div style={{display: 'flex', alignItems: 'center', gap: 4, marginTop: 32, ...line(title.length + 1)}}>
          <span style={txt(19, 500, '#fff', {lineHeight: '28px'})}>Подробнее</span>
          <Icon name="arrow-up-right" size={24} />
        </div>
      </div>
    </>
  );
};

export const Bullets: React.FC<{active: number; opacity: number}> = ({active, opacity}) => {
  // active 0..1 moves the long pill from the 1st to the 2nd bullet
  const w = (i: number) => 8 + 14 * Math.max(0, 1 - Math.abs(active - i));
  return (
    <div
      style={{
        ...abs(BANNER_TEXT_X + 1148 - 60, BANNER.y + BANNER.h - 200 - 8, 60, 8),
        display: 'flex',
        justifyContent: 'flex-end',
        gap: 4,
        opacity,
      }}
    >
      {[0, 1, 2].map((i) => (
        <div key={i} style={{width: w(i), height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.4)', position: 'relative'}}>
          <div
            style={{
              position: 'absolute',
              left: 2,
              top: 2,
              width: 4 + (w(i) - 8),
              height: 4,
              borderRadius: 19,
              background: '#fff',
              opacity: Math.max(0, 1 - Math.abs(active - i)),
            }}
          />
        </div>
      ))}
    </div>
  );
};

// ───────────────────────────── «Москва • Куда летаем» ─────────────────────────────
const CITY = [
  {src: 'img/city-1.jpg', price: 'от 12 416 ₽'},
  {src: 'img/city-2.jpg', price: 'от 15 246 ₽'},
];

export const Wrapper: React.FC<{y: number; opacity: number}> = ({y, opacity}) => (
  <div style={{...abs(-400, WRAPPER_Y + y, PAGE_W + 800, 1400), opacity}}>
    <div
      style={{
        position: 'absolute',
        left: 400,
        top: 0,
        width: PAGE_W,
        height: 1400,
        background: C.pageBg,
        borderTopLeftRadius: TOP.radius,
        borderTopRightRadius: TOP.radius,
      }}
    />
    {/* wide bg so the page edge never shows below the banner */}
    <div style={{position: 'absolute', left: 0, top: 120, width: PAGE_W + 800, height: 1280, background: C.pageBg}} />
    <div style={{...abs(400 + 472, 106, 820, 40), display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
      <span style={txt(30, 500, C.primary, {letterSpacing: -0.3})}>Москва • Куда летаем</span>
      <div style={{display: 'flex', alignItems: 'center', gap: 4}}>
        <span style={txt(19, 500, C.secondary)}>Все направления</span>
        <Icon name="gate-arrow" size={20} style={{opacity: 0.6}} />
      </div>
    </div>
    {CITY.map((c, i) => (
      <div
        key={c.src}
        style={{
          ...abs(400 + 465 + i * 405, 164, 397, 520),
          borderRadius: 56,
          overflow: 'hidden',
        }}
      >
        <Img src={asset(c.src)} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
        <div
          style={{
            position: 'absolute',
            right: 22,
            top: 30,
            padding: '6px 12px',
            borderRadius: 100,
            background: 'rgba(34,36,40,0.72)',
            ...txt(15, 500, '#fff'),
          }}
        >
          {c.price}
        </div>
      </div>
    ))}
  </div>
);

// three "browser" dots above the page (Figma Frame 2131330566)
export const PageDots: React.FC<{opacity: number}> = ({opacity}) => (
  <div style={{...abs(45, -36, 60, 15), display: 'flex', gap: 6, opacity}}>
    {['#222428', '#d3d6da', '#d3d6da'].map((c, i) => (
      <div key={i} style={{width: 14.4, height: 14.4, borderRadius: 8, background: c}} />
    ))}
  </div>
);
