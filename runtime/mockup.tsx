import {Img, useVideoConfig} from 'remotion';
import type {ScreenTemplate} from './manifest';
import {asset, useProject} from './timeline';

type Mockup = NonNullable<ScreenTemplate['mockup']>;

/** the standard iPhone 17 Air numbers, for a project created before the mockup was chosen */
const FALLBACK: Required<Pick<Mockup, 'size' | 'screen'>> = {
  size: [1712, 3519],
  screen: {x: 67, y: 58, w: 1577, h: 3403, r: 124},
};

/**
 * A phone around the screen content. The content sits UNDER the device image (its screen is transparent),
 * clipped to the screen rect; with `contentWidth` the children are laid out at that width (the Figma frame
 * width, e.g. 393) and scaled to fit the screen — so element sizes from the design stay as they are.
 * Size the phone with `height` (px of the video); place it with `style` (it is a plain block).
 */
export const DeviceMockup: React.FC<{
  children: React.ReactNode;
  height?: number;
  contentWidth?: number;
  mockup?: Mockup;
  style?: React.CSSProperties;
  screenStyle?: React.CSSProperties;
}> = ({children, height, contentWidth, mockup, style, screenStyle}) => {
  const project = useProject();
  const {height: videoH} = useVideoConfig();
  const m = mockup ?? project?.screen?.mockup;
  const [iw, ih] = m?.size ?? FALLBACK.size;
  const sc = m?.screen ?? FALLBACK.screen;
  const H = height ?? Math.round(videoH * 0.82);
  const k = H / ih;
  const W = iw * k;
  const sw = sc.w * k;
  const sh = sc.h * k;
  const inner = contentWidth ? {w: contentWidth, h: (contentWidth * sh) / sw, s: sw / contentWidth} : null;
  return (
    <div style={{position: 'relative', width: W, height: H, flexShrink: 0, ...style}}>
      <div
        style={{
          position: 'absolute',
          left: sc.x * k,
          top: sc.y * k,
          width: sw,
          height: sh,
          borderRadius: sc.r * k,
          overflow: 'hidden',
          // no opaque fill here: headless Chrome then skips drawing what lies behind the zoomed phone (a black band)
          ...screenStyle,
        }}
      >
        {inner ? (
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: inner.w,
              height: inner.h,
              transform: `scale(${inner.s})`,
              transformOrigin: '0 0',
            }}
          >
            {children}
          </div>
        ) : (
          children
        )}
      </div>
      {m ? (
        <Img
          src={asset(m.file ?? 'mockup/device.png')}
          style={{position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none'}}
        />
      ) : null}
    </div>
  );
};
