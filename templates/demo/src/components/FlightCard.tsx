// Flight card (Figma «full card small», 1334 × 200, screen px).
import {C, Icon, txt} from './ui';

export const CARD_W = 1334;
export const CARD_H = 200;

export type Flight = {transfer: string; transferColor: string; price: string};

export const FLIGHTS: Flight[] = [
  {transfer: 'Прямой рейс', transferColor: C.green, price: 'от 13 068 ₽'},
  {transfer: '1 пересадка', transferColor: C.orange, price: 'от 999 132 ₽'},
  {transfer: '1 пересадка', transferColor: C.orange, price: 'от 1 132 ₽'},
];

const Dots: React.FC<{n: number}> = ({n}) => (
  <>
    {Array.from({length: n}, (_, i) => (
      <div key={i} style={{width: 2.65, height: 2.65, borderRadius: 2, background: '#c5cad2', flexShrink: 0}} />
    ))}
  </>
);

export const FlightCard: React.FC<{f: Flight; style?: React.CSSProperties}> = ({f, style}) => (
  <div
    style={{
      position: 'absolute',
      width: CARD_W,
      height: CARD_H,
      boxSizing: 'border-box',
      background: '#fff',
      borderRadius: 74.1,
      padding: '7.94px 7.94px 7.94px 37.05px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      ...style,
    }}
  >
    <div style={{width: 741, display: 'flex', flexDirection: 'column', gap: 15.88, padding: '26.46px 0'}}>
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
        <div style={{width: 137.6, display: 'flex', alignItems: 'center', gap: 10.6}}>
          <Icon name="s7-round" size={31.76} />
          <span style={txt(24.5, 500, C.secondary, {lineHeight: '35px'})}>S7 Airlines</span>
        </div>
        <span style={txt(18.5, 500, f.transferColor, {lineHeight: '26.5px'})}>{f.transfer}</span>
        <div style={{width: 137.6, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2.6}}>
          <span style={txt(18.5, 500, C.tertiary, {lineHeight: '26.5px', padding: '0 5.3px'})}>Подробнее</span>
          <Icon name="arrow-right-sm" size={21.2} />
        </div>
      </div>
      <div style={{display: 'flex', flexDirection: 'column', gap: 2.65}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 17.2}}>
          <span style={txt(37, 500, C.primary, {lineHeight: '42.3px', letterSpacing: -0.74})}>23:05</span>
          <div style={{flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10.6}}>
            <span style={txt(18.5, 400, C.primary, {flex: 1, textAlign: 'right'})}>DME</span>
            <div style={{display: 'flex', alignItems: 'center', gap: 7.94}}>
              <Dots n={11} />
              <span style={txt(18.5, 400, C.tertiary, {width: 43.7, textAlign: 'center'})}>OVB</span>
              <Dots n={11} />
            </div>
            <span style={txt(18.5, 400, C.primary, {flex: 1})}>MRV</span>
          </div>
          <span style={txt(37, 500, C.primary, {lineHeight: '42.3px', letterSpacing: -0.74})}>12:45</span>
        </div>
        <div style={{display: 'flex', ...txt(18.5, 400, C.secondary, {lineHeight: '26.5px'})}}>
          <span style={{width: 112.5}}>вт, 5 мая</span>
          <span style={{flex: 1, textAlign: 'center'}}>3ч 25м</span>
          <span style={{width: 112.5, textAlign: 'right'}}>5 мая, вт</span>
        </div>
      </div>
    </div>
    <div
      style={{
        width: 496.2,
        height: '100%',
        boxSizing: 'border-box',
        background: C.field,
        borderRadius: 63.5,
        padding: '0 42.3px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 42.3,
      }}
    >
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2.65}}>
        <span style={txt(37, 500, C.primary, {lineHeight: '42.3px', letterSpacing: -0.74})}>{f.price}</span>
        <span style={txt(18.5, 400, C.secondary, {lineHeight: '26.5px'})}>с багажом 1 935 662 ₽</span>
      </div>
      <div style={{background: '#e9ebed', borderRadius: 300, padding: '21.17px 31.76px'}}>
        <span style={txt(22.5, 500, C.primary, {lineHeight: '31.8px'})}>Выбрать</span>
      </div>
    </div>
  </div>
);

export const FlightsTitle: React.FC<{text: string; route: string; style?: React.CSSProperties}> = ({text, route, style}) => (
  <div style={{position: 'absolute', display: 'flex', flexDirection: 'column', gap: 5.3, ...style}}>
    <span style={txt(50.8, 500, C.primary, {lineHeight: '55.4px', letterSpacing: -1.016})}>{text}</span>
    <div style={{display: 'flex', alignItems: 'center', gap: 5.3}}>
      <span style={txt(25.1, 500, C.tertiary, {lineHeight: '37px'})}>Москва</span>
      <Icon name="arrow-right" size={21.2} style={{opacity: 0.75}} />
      <span style={txt(25.1, 500, C.tertiary, {lineHeight: '37px'})}>{route}</span>
    </div>
  </div>
);
