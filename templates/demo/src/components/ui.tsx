// Small shared bits: icons from Figma (svg), text styles.
import {Img} from 'remotion';
import {FONT} from '../fonts';
import {asset} from '../moootion';

export const C = {
  primary: '#222428',
  primary2: '#222a37',
  secondary: '#8c939f',
  tertiary: '#a6abb5',
  placeholder: '#95a0b3',
  quaternary: '#bbbfc7',
  green: '#90c241',
  greenSel: '#97ba1e',
  orange: '#ff991f',
  field: '#f6f6f7',
  pageBg: '#f1f2f4',
  shadow: '0px 5px 16px 0px rgba(17,18,20,0.05), 0px 12px 56px 0px rgba(17,18,20,0.05)',
};

export const Icon: React.FC<{name: string; size: number; h?: number; style?: React.CSSProperties}> = ({
  name,
  size,
  h,
  style,
}) => <Img src={asset(`icons/${name}.svg`)} style={{width: size, height: h ?? size, display: 'block', flexShrink: 0, ...style}} />;

export const txt = (size: number, weight: 400 | 500, color: string, extra?: React.CSSProperties): React.CSSProperties => ({
  fontFamily: FONT,
  fontWeight: weight,
  fontSize: size,
  color,
  whiteSpace: 'nowrap',
  fontFeatureSettings: '"calt" 0',
  ...extra,
});
