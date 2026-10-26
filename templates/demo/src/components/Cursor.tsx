// Arrow cursor from the storyboard (black arrow, white outline, soft shadow).
// (x, y) is the tip.
export const Cursor: React.FC<{x: number; y: number; scale: number; opacity: number}> = ({x, y, scale, opacity}) => (
  <svg
    width={200}
    height={200}
    viewBox="-110 -20 200 200"
    style={{
      position: 'absolute',
      left: x - 110,
      top: y - 20,
      opacity,
      overflow: 'visible',
      transform: `scale(${scale})`,
      transformOrigin: '110px 20px',
      filter: 'drop-shadow(0px 14px 22px rgba(0,0,0,0.22))',
    }}
  >
    <path
      d="M0 0 L-92 93 L-30 88 L28 130 Z"
      fill="#000"
      stroke="#fff"
      strokeWidth={13}
      strokeLinejoin="round"
      paintOrder="stroke"
    />
  </svg>
);
