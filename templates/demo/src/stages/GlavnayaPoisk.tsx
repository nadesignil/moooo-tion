// Сцена «Главная и поиск». Одна непрерывная камера над страницей S7:
// облака → баннер на сайте → баннер с милями → форма → «Мальдивы» → календарь →
// выбор 7–10 → переход к рейсам. КОГДА и с какими параметрами — только из манифеста.
import {useEffect, useState} from 'react';
import {AbsoluteFill, Audio, Img, cancelRender, continueRender, delayRender} from 'remotion';
import {Calendar, CalendarState, dayPos} from '../components/Calendar';
import {Cursor} from '../components/Cursor';
import {FLIGHTS, FlightCard, FlightsTitle} from '../components/FlightCard';
import {
  BannerText,
  Bullets,
  FilterRow,
  Header,
  PageDots,
  PageTabs,
  SearchForm,
  TopBlockBg,
  Wrapper,
} from '../components/Page';
import {C} from '../components/ui';
import {loadFonts} from '../fonts';
import {CAL, COINS, HERO_IMG, PAGE_W, Cam, calToPage, cellCenter, toScreen} from '../geometry';
import {Layer, asset, clamp01, mix, mixColor, num, str, useLayer, useTimeline} from '../moootion';

type At = ReturnType<typeof useTimeline>['at'];

const CAM_CHAIN = ['cam-site', 'cam-miles', 'cam-form', 'cam-type', 'cam-calendar', 'cam-dates'];

const lerpCam = (a: Cam, b: Cam, t: number): Cam => ({
  cx: mix(a.cx, b.cx, t),
  cy: mix(a.cy, b.cy, t),
  s: mix(a.s, b.s, t),
  rx: mix(a.rx, b.rx, t),
  ry: mix(a.ry, b.ry, t),
  rz: mix(a.rz, b.rz, t),
});

/** camera at frame f: the hero push, then a chain of moves, each from the previous target */
const cameraAt = (at: At, f: number): Cam => {
  const h = at('cam-hero', f);
  const hp = h.params;
  let prev: Cam = {cx: num(hp.cx, 890.9), cy: num(hp.cy, 605.8), s: num(hp.s, 1.182), rx: 0, ry: 0, rz: 0};
  let cam = lerpCam(
    {cx: num(hp.cxFrom, prev.cx), cy: num(hp.cyFrom, prev.cy), s: num(hp.sFrom, prev.s), rx: 0, ry: 0, rz: 0},
    prev,
    h.p,
  );
  for (const id of CAM_CHAIN) {
    const c = at(id, f);
    if (c.missing) continue;
    const q = c.params;
    const target: Cam = {
      cx: num(q.cx, prev.cx),
      cy: num(q.cy, prev.cy),
      s: num(q.s, prev.s),
      rx: num(q.rx, 0),
      ry: num(q.ry, 0),
      rz: num(q.rz, 0),
    };
    if (!c.started) break;
    cam = lerpCam(prev, target, c.p);
    prev = target;
  }
  return cam;
};

const camTransform = (c: Cam) => {
  const tilt = c.rx !== 0 || c.ry !== 0 ? ` rotateX(${c.rx}deg) rotateY(${c.ry}deg)` : '';
  return `translate(960px, 540px) rotate(${c.rz}deg)${tilt} scale(${c.s}) translate(${-c.cx}px, ${-c.cy}px)`;
};

/** staggered progress of an action: element i starts i·stagger seconds later */
const staggered = (at: At, id: string, frame: number, fps: number, i: number, stagger: number) =>
  at(id, frame - i * stagger * fps).p;

export const GlavnayaPoisk: React.FC = () => {
  const [handle] = useState(() => delayRender('Loading fonts'));
  useEffect(() => {
    loadFonts()
      .then(() => continueRender(handle))
      .catch((err) => cancelRender(err));
  }, [handle]);

  const {at, frame, fps} = useTimeline();

  // ── фон и общий свет
  const uiHide = at('ui-hide').p;
  const bgGrey = at('bg-grey');
  // серый сайт → белый фон формы → снова серый у рейсов
  const bg = bgGrey.started
    ? mixColor('#ffffff', str(bgGrey.params.color, C.pageBg), bgGrey.p)
    : mixColor(C.pageBg, '#ffffff', uiHide);
  const fadeIn = at('fade-in');
  const black = Math.max(fadeIn.missing ? 0 : 1 - fadeIn.p, at('fade-out').p);

  // ── камера
  const camOut = at('cam-out');
  const cam = cameraAt(at, frame);
  const worldCam = {...cam, s: cam.s * mix(1, num(camOut.params.push, 1.9), camOut.p)};
  const worldBlur = camOut.p * num(camOut.params.blur, 14);

  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      <Layer name="Фон" style={{background: bg}}>
        {null}
      </Layer>
      <Layer name="Музыка">
        <Music />
      </Layer>
      <Layer
        name="Камера"
        style={{
          perspective: 2400,
          perspectiveOrigin: '960px 540px',
          opacity: 1 - camOut.p,
          filter: worldBlur > 0.05 ? `blur(${worldBlur}px)` : undefined,
        }}
      >
        {camOut.p < 1 ? (
          <div style={{position: 'absolute', left: 0, top: 0, width: PAGE_W, transformOrigin: '0 0', transform: camTransform(worldCam)}}>
            <Layer name="Страница">
              <World />
            </Layer>
          </div>
        ) : null}
      </Layer>
      <Layer name="Курсор">
        <CursorLayer cam={cam} />
      </Layer>
      <Flights />
      <Layer name="Кадр" style={{background: '#000', opacity: black}}>
        {null}
      </Layer>
    </AbsoluteFill>
  );
};

const Music: React.FC = () => {
  const {at, fps} = useTimeline();
  const {muted} = useLayer();
  const music = at('music');
  if (music.missing) return null;
  const musicFrames = music.f1 - music.f0;
  return (
    <Audio
      src={asset('audio/music.mp3')}
      startFrom={Math.round(num(music.params.from, 0) * fps)}
      volume={(f) =>
        muted
          ? 0
          : num(music.params.volume, 1) *
            clamp01(f / (num(music.params.fadeIn, 0.3) * fps)) *
            clamp01((musicFrames - f) / (num(music.params.fadeOut, 1) * fps))
      }
    />
  );
};

// ───────────────────────────── страница в пространстве камеры ─────────────────────────────
const World: React.FC = () => {
  const {at, frame, fps} = useTimeline();
  const uiHide = at('ui-hide').p;

  const topIn = at('top-in');
  const topY = -(1 - topIn.p) * num(topIn.params.distance, 420);
  const topVis = clamp01(topIn.p * 3);
  const wrapperIn = at('wrapper-in');
  const wrapY = (1 - wrapperIn.p) * num(wrapperIn.params.distance, 360);

  const tabs = at('tabs-hide');
  const datesOut = at('dates-out');

  // typing «Мальдивы» заборчиком
  const typing = at('typing');
  const text = str(typing.params.text, 'Мальдивы');
  const tStagger = num(typing.params.stagger, 0.107);
  const letters = text.split('').map((_, i) => staggered(at, 'typing', frame, fps, i, tStagger));

  return (
    <>
      <Layer name="Видео-баннер">
        <BannerLayer opacity={1 - uiHide} />
      </Layer>
      <Layer name="Блок «Куда летаем»">
        {wrapperIn.started ? <Wrapper y={wrapY} opacity={1 - uiHide} /> : null}
      </Layer>
      <Layer name="Шапка">
      {topIn.started ? (
        <>
          <PageDots opacity={topVis * (1 - uiHide)} />
          <TopBlockBg y={topY} />
          <Header y={topY} opacity={topVis * (1 - uiHide)} />
          <Layer name="Табы «Покупка»">
            <PageTabs y={topY - tabs.p * num(tabs.params.lift, 30)} opacity={topVis * (1 - tabs.p)} />
          </Layer>
          <FilterRow y={topY} opacity={topVis * (1 - uiHide)} />
          <SearchForm
            y={topY}
            opacity={topVis * (1 - datesOut.p)}
            cardOpacity={1}
            typing={{
              text,
              letters,
              rise: num(typing.params.rise, 18),
              blur: num(typing.params.blur, 6),
              placeholder: 1 - at('placeholder-out').p,
            }}
          />
        </>
      ) : null}
      </Layer>
      <Layer name="Календарь">
        <CalendarLayer />
      </Layer>
    </>
  );
};

// ── видео-баннер: облака → слайд с милями
const BannerLayer: React.FC<{opacity: number}> = ({opacity}) => {
  const {at, frame, fps} = useTimeline();
  const drift = at('hero-drift');
  const zoom = mix(num(drift.params.zoomFrom, 1), num(drift.params.zoomTo, 1.09), drift.lin);
  const swap = at('slide-swap');
  const sw = swap.p;
  const parallax = num(swap.params.parallax, 0.35);

  const b1 = at('banner1-text');
  const b1p = [0, 1, 2, 3].map((i) => staggered(at, 'banner1-text', frame, fps, i, num(b1.params.stagger, 0.07)));
  const b2 = at('banner2-text');
  const b2p = [0, 1, 2, 3].map((i) => staggered(at, 'banner2-text', frame, fps, i, num(b2.params.stagger, 0.07)));
  const topIn = at('top-in');

  if (opacity <= 0.001) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: HERO_IMG.x,
        top: HERO_IMG.y,
        width: HERO_IMG.w,
        height: HERO_IMG.h,
        overflow: 'hidden',
        opacity,
      }}
    >
      {/* облака с самолётом */}
      {sw < 1 ? (
        <div style={{position: 'absolute', inset: 0, transform: `translateX(${-sw * parallax * PAGE_W}px)`}}>
          <Img
            src={asset('img/hero.jpg')}
            style={{
              position: 'absolute',
              width: '100%',
              height: '100%',
              transform: `translate(${num(drift.params.panX, 0) * drift.lin}px, ${num(drift.params.panY, 0) * drift.lin}px) scale(${zoom})`,
            }}
          />
        </div>
      ) : null}
      {/* баннер «В два раза больше миль» */}
      {swap.started ? (
        <div style={{position: 'absolute', inset: 0, transform: `translateX(${(1 - sw) * PAGE_W}px)`}}>
          <Img src={asset('img/miles-bg.jpg')} style={{position: 'absolute', width: '100%', height: '100%', objectFit: 'cover'}} />
          <Layer name="Монеты">
            <Coins />
          </Layer>
        </div>
      ) : null}
      {/* тексты обоих слайдов — один слой; текст 1 обрезан по краю въезжающего слайда 2 */}
      <Layer name="Текст баннера">
        {sw < 1 ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              transform: `translateX(${-sw * parallax * PAGE_W}px)`,
              clipPath: swap.started ? `inset(0 ${Math.max(0, HERO_IMG.w - (1 - sw + sw * parallax) * PAGE_W)}px 0 0)` : undefined,
            }}
          >
            <div style={{position: 'absolute', left: 0, top: -HERO_IMG.y, opacity: topIn.p}}>
              <BannerText title={['Летать', 'по-новому']} sub="Новые интерфейсы" p={b1p} rise={num(b1.params.rise, 40)} />
            </div>
          </div>
        ) : null}
        {swap.started ? (
          <div style={{position: 'absolute', inset: 0, transform: `translateX(${(1 - sw) * PAGE_W}px)`}}>
            <div style={{position: 'absolute', left: 0, top: -HERO_IMG.y}}>
              <BannerText title={['В два раза больше', 'миль за полет']} sub="до 29.03" p={b2p} rise={num(b2.params.rise, 40)} />
            </div>
          </div>
        ) : null}
      </Layer>
      <div style={{position: 'absolute', left: 0, top: -HERO_IMG.y}}>
        <Bullets active={sw} opacity={topIn.p} />
      </div>
    </div>
  );
};

const coinsY = (at: At, f: number) => {
  const fall = at('coins-fall', f);
  return -(1 - fall.p) * num(fall.params.height, 900);
};

const Coins: React.FC = () => {
  const {at, frame} = useTimeline();
  const fall = at('coins-fall');
  if (!fall.started) return null;
  const land = at('coins-land');
  const d = land.started ? 1 - land.p : 0; // 1 at impact, oscillates through 0
  const squash = num(land.params.squash, 0.07) * d;
  const y = coinsY(at, frame);
  const sigma = Math.min(40, Math.abs(y - coinsY(at, frame - 1)) * 0.35 * num(fall.params.blur, 1));
  return (
    <>
      <svg width={0} height={0} style={{position: 'absolute'}}>
        <filter id="coinsBlur" x="-20%" y="-40%" width="140%" height="180%">
          <feGaussianBlur stdDeviation={`0 ${sigma}`} />
        </filter>
      </svg>
      <Img
        src={asset('img/coins.png')}
        style={{
          position: 'absolute',
          left: COINS.x,
          top: COINS.y - HERO_IMG.y + y,
          width: COINS.w,
          height: COINS.h,
          transformOrigin: '50% 100%',
          transform: `rotate(${(1 - fall.p) * num(fall.params.spin, -14)}deg) scale(${1 + squash * 0.6}, ${1 - squash})`,
          filter: sigma > 0.3 ? 'url(#coinsBlur)' : undefined,
        }}
      />
    </>
  );
};

// ── календарь
const KEEP = new Set([7, 8, 9, 10]);
const ROW7 = dayPos(7).row;

const CalendarLayer: React.FC = () => {
  const {at, frame, fps} = useTimeline();
  const open = at('calendar-in');
  if (!open.started) return null;
  const datesIn = at('dates-in');
  const inStagger = num(datesIn.params.stagger, 0.012);
  const datesOut = at('dates-out');
  const outStagger = num(datesOut.params.stagger, 0.012);
  const rise = num(datesIn.params.rise, 10);

  const inP = (m: number, day: number) => {
    const {col, row} = dayPos(day);
    return staggered(at, 'dates-in', frame, fps, col + row + m * 7, inStagger);
  };
  const outP = (m: number, day: number) => {
    if (m === 0 && KEEP.has(day)) return 0;
    const {col, row} = dayPos(day);
    const dist = Math.abs(row - ROW7) * 2 + Math.abs(col + m * 7 - 1.5);
    return staggered(at, 'dates-out', frame, fps, dist, outStagger);
  };
  const st: CalendarState = {
    chrome: open.p * (1 - datesOut.p),
    cell: (m, day) => inP(m, day) * (1 - outP(m, day)),
    rise: (m, day) => (1 - inP(m, day)) * rise,
    sel7: at('select-7').p,
    sel10: at('select-10').p,
    range: at('range-fill').p,
  };
  const s = mix(num(open.params.fromScale, 0.92), 1, open.p);
  return (
    <div style={{position: 'absolute', left: CAL.x, top: CAL.y, transformOrigin: '0 0', transform: `scale(${CAL.k})`}}>
      <div
        style={{
          position: 'absolute',
          width: CAL.w,
          height: CAL.h,
          transformOrigin: '90% 0%',
          transform: `translateY(${(1 - open.p) * num(open.params.fromY, -40)}px) scale(${s})`,
          opacity: clamp01(open.p * 1.4),
        }}
      >
        <Calendar st={st} />
      </div>
    </div>
  );
};

// ───────────────────────────── курсор (экран) ─────────────────────────────
const CursorLayer: React.FC<{cam: Cam}> = ({cam}) => {
  const {at} = useTimeline();
  const cin = at('cursor-in');
  const out = at('cursor-out');
  if (!cin.started || out.done) return null;
  const move = at('cursor-move');
  const tip = {x: num(cin.params.tipX, 18), y: num(cin.params.tipY, 62)};
  const cell = (day: number) => {
    const {col, row} = dayPos(day);
    const s = toScreen(cam, calToPage(cellCenter(0, col, row)));
    return {x: s.x + tip.x, y: s.y + tip.y};
  };
  const p7 = cell(7);
  const p10 = cell(10);
  const from = {x: num(cin.params.fromX, 1750), y: num(cin.params.fromY, 1180)};
  let x = mix(from.x, p7.x, cin.p);
  let y = mix(from.y, p7.y, cin.p);
  if (move.started) {
    x = mix(p7.x, p10.x, move.p);
    y = mix(p7.y, p10.y, move.p) + Math.sin(Math.PI * move.p) * num(move.params.arc, -60);
  }
  x += out.p * num(out.params.toX, 420);
  y += out.p * num(out.params.toY, 520);
  const press = (id: string) => {
    const c = at(id);
    return num(c.params.depth, 0.14) * Math.sin(Math.PI * c.lin);
  };
  const scale = 1 - press('click-7') - press('click-10');
  return <Cursor x={x} y={y} scale={scale} opacity={clamp01(cin.p * 3) * (1 - out.p)} />;
};

// ───────────────────────────── рейсы (экран) ─────────────────────────────
type Pose = {x: number; y: number; s: number; o: number};
// Figma 2275 (колода) → 2282 (список)
const DECK: Pose[] = [
  {x: 293, y: 408, s: 1, o: 1},
  {x: 333, y: 567, s: 0.94, o: 0.5},
  {x: 428, y: 697, s: 0.798, o: 0.22},
];
const LIST: Pose[] = [
  {x: 293, y: 256, s: 1, o: 1},
  {x: 307, y: 471, s: 0.978, o: 1},
  {x: 335, y: 679, s: 0.938, o: 1},
];

const Flights: React.FC = () => {
  const {at, frame, fps} = useTimeline();
  const title = at('title-in');
  const cards = at('cards-in');
  if (!title.started && !cards.started) {
    return (
      <>
        <Layer name="Заголовок рейсов">{null}</Layer>
        <Layer name="Карточки рейсов">{null}</Layer>
      </>
    );
  }

  const tOut = at('title-out');
  const tp = title.p;
  const spread = at('cards-spread').p;
  const fl = at('cards-float');
  const env = fl.started ? clamp01((frame - fl.f0) / (0.8 * fps)) : 0;
  const tSec = (frame - fl.f0) / fps;

  return (
    <>
      <Layer name="Заголовок рейсов">
      {tOut.p < 1 ? (
        <FlightsTitle
          text={str(title.params.text, 'Выберите рейс туда · 7 ноября, вт')}
          route={str(title.params.route, 'Мале')}
          style={{
            left: 349,
            top: 258 + (1 - tp) * num(title.params.rise, 60) - tOut.p * num(tOut.params.lift, 120),
            opacity: clamp01(tp * 1.3) * (1 - tOut.p),
            filter: tp < 1 ? `blur(${(1 - tp) * num(title.params.blur, 10)}px)` : undefined,
          }}
        />
      ) : null}
      </Layer>
      <Layer name="Карточки рейсов">
      {[2, 1, 0].map((i) => {
        const pin = staggered(at, 'cards-in', frame, fps, i, num(cards.params.stagger, 0.2146));
        const a = DECK[i];
        const b = LIST[i];
        const bob = Math.sin(tSec * Math.PI * 2 * num(fl.params.freq, 0.35) + i * 1.3) * num(fl.params.amp, 5) * env;
        return (
          <FlightCard
            key={i}
            f={FLIGHTS[i]}
            style={{
              left: mix(a.x, b.x, spread),
              top: mix(a.y, b.y, spread) + (1 - pin) * num(cards.params.rise, 420) + bob,
              opacity: mix(a.o, b.o, clamp01(spread)) * clamp01(pin * 1.5),
              transformOrigin: '0 0',
              transform: `scale(${mix(a.s, b.s, spread)})`,
              boxShadow: '0 10px 40px rgba(17,18,20,0.04)',
            }}
          />
        );
      })}
      </Layer>
    </>
  );
};
