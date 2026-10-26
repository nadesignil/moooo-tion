// Date picker (Figma DatePicker): two months, prices under the days.
// Drawn in its own 821 × 440 units; the stage places it in page space.
import {CAL, CAL_PAD, CELL_H, CELL_W, MONTH_W, cellCenter} from '../geometry';
import {Layer} from '../moootion';
import {C, Icon, txt} from './ui';

const P = {
  a: '120 800',
  b: '13 543',
  g: '9 678',
  c: '14 680',
  d: '20 740',
  e: '19 640',
  f: '15 200',
  h: '13 760',
  i: '12 654',
};
// prices as in the storyboard (October, November)
const OCT = 'abgcdefhgdibccbecbdbdbdecedebce';
const NOV_HEAD = 'ibgcdefhgdibc';
const MONTHS = [
  {title: 'Октябрь 2024', prices: OCT.split('')},
  {title: 'Ноябрь 2024', prices: (NOV_HEAD + OCT.slice(13, 27) + 'aaaa').split('')},
];
const WEEK = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];
const FIRST_COL = 1; // both months start on Tuesday in the storyboard

export const dayPos = (day: number) => {
  const i = day - 1 + FIRST_COL;
  return {col: i % 7, row: Math.floor(i / 7)};
};

export type CalendarState = {
  /** card bg, headings, weekdays, footer */
  chrome: number;
  /** per-cell visibility: (month, day) → 0..1 */
  cell: (month: number, day: number) => number;
  /** per-cell rise for the wave */
  rise: (month: number, day: number) => number;
  /** selection 0..1 for Oct 7 and Oct 10 (spring, may overshoot) */
  sel7: number;
  sel10: number;
  /** range background 0..1 (grows from 7 to 10) */
  range: number;
};

export const Calendar: React.FC<{st: CalendarState; style?: React.CSSProperties}> = ({st, style}) => {
  const c7 = cellCenter(0, dayPos(7).col, dayPos(7).row);
  const c10 = cellCenter(0, dayPos(10).col, dayPos(10).row);
  const rangeLeft = c7.x - CELL_W / 2;
  const rangeFull = c10.x + CELL_W / 2 - rangeLeft;
  const selCircle = (p: number, center: {x: number; y: number}) => (
    <div
      style={{
        position: 'absolute',
        left: center.x - CELL_W / 2,
        top: center.y - CELL_H / 2,
        width: CELL_W,
        height: CELL_H,
        borderRadius: 40,
        background: C.greenSel,
        transform: `scale(${0.4 + 0.6 * p})`,
        opacity: Math.min(1, p * 2),
      }}
    />
  );
  return (
    <div style={{position: 'absolute', width: CAL.w, height: CAL.h, ...style}}>
      <div
        style={{position: 'absolute', inset: 0, background: '#fff', borderRadius: 48, boxShadow: C.shadow, opacity: st.chrome}}
      />
      {/* диапазон 7–10 */}
      <Layer name="Диапазон дат">
        <div
          style={{
            position: 'absolute',
            left: rangeLeft,
            top: c7.y - CELL_H / 2,
            width: CELL_W + (rangeFull - CELL_W) * Math.max(0, st.range),
            height: CELL_H,
            borderRadius: 40,
            background: 'rgba(236,239,245,0.6)',
            opacity: Math.min(1, st.range * 3),
          }}
        />
      </Layer>
      <Layer name="Дата 7">{selCircle(st.sel7, c7)}</Layer>
      <Layer name="Дата 10">{selCircle(st.sel10, c10)}</Layer>
      {MONTHS.map((m, mi) => {
        const x0 = CAL_PAD + mi * (MONTH_W + CAL_PAD);
        return (
          <div key={mi}>
            <div
              style={{
                position: 'absolute',
                left: x0,
                top: 12,
                width: MONTH_W,
                height: 48,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: st.chrome,
              }}
            >
              <span style={txt(17, 500, C.primary, {letterSpacing: -0.17, wordSpacing: 4})}>{m.title}</span>
              <Icon
                name={mi === 0 ? 'chevron-a' : 'chevron-b'}
                size={20}
                style={{position: 'absolute', [mi === 0 ? 'left' : 'right']: 6, top: 14}}
              />
            </div>
            {WEEK.map((w, wi) => (
              <div
                key={w}
                style={{
                  position: 'absolute',
                  left: x0 + wi * CELL_W,
                  top: 72,
                  width: CELL_W,
                  textAlign: 'center',
                  opacity: st.chrome,
                  ...txt(12, 500, C.secondary, {lineHeight: '16px'}),
                }}
              >
                {w}
              </div>
            ))}
          </div>
        );
      })}
      {/* ячейки обоих месяцев — один слой (с заголовками месяцев не пересекаются) */}
      <Layer name="Даты">
        {MONTHS.map((m, mi) =>
          m.prices.map((code, di) => {
              const day = di + 1;
              const {col, row} = dayPos(day);
              const c = cellCenter(mi, col, row);
              const v = st.cell(mi, day);
              if (v <= 0.001) return null;
              const sel = mi === 0 ? (day === 7 ? st.sel7 : day === 10 ? st.sel10 : 0) : 0;
              const s = Math.min(1, Math.max(0, sel));
              const price = P[code as keyof typeof P];
              const priceColor = code === 'g' ? C.green : C.secondary;
              return (
                <div
                  key={day}
                  style={{
                    position: 'absolute',
                    left: c.x - CELL_W / 2,
                    top: c.y - CELL_H / 2 + st.rise(mi, day),
                    width: CELL_W,
                    height: CELL_H,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: v,
                    transform: `scale(${0.85 + 0.15 * Math.min(1, v)})`,
                  }}
                >
                  <span style={txt(17, 400, s > 0.5 ? '#fff' : C.primary, {lineHeight: '24px', marginBottom: -2})}>{day}</span>
                  <span style={txt(10, 400, s > 0.5 ? '#fff' : priceColor, {lineHeight: '14px'})}>{price}</span>
                </div>
              );
          }),
        )}
      </Layer>
      {/* footer */}
      <div
        style={{
          position: 'absolute',
          left: 32,
          right: 28,
          top: 368,
          height: 48,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          opacity: st.chrome,
        }}
      >
        <span style={txt(14, 400, C.tertiary)}>Цена за 1 пассажира в одну сторону</span>
        <div
          style={{
            height: 48,
            padding: '0 20px',
            borderRadius: 200,
            background: 'rgba(233,235,237,0.6)',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <span style={txt(17, 500, C.quaternary)}>Обратный билет не нужен</span>
        </div>
      </div>
    </div>
  );
};

