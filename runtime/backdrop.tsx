import {useLayoutEffect, useRef} from 'react';
import {AbsoluteFill, Img, useCurrentFrame, useVideoConfig} from 'remotion';
import type {Background} from './manifest';
import {SHADERS, ShaderRenderer} from './shaders';
import {asset, useProject} from './timeline';

/** A shader drawn at an explicit time — usable outside Remotion (the studio picker). */
export const ShaderCanvas: React.FC<{
  shader: string;
  time: number;
  width: number;
  height: number;
  colors?: string[];
  seed?: number;
  zoom?: number;
  style?: React.CSSProperties;
}> = ({shader, time, width, height, colors, seed, zoom, style}) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<ShaderRenderer | null>(null);
  useLayoutEffect(() => {
    return () => {
      renderer.current?.dispose();
      renderer.current = null;
    };
  }, []);
  // drawn synchronously before paint, so a rendered frame never shows the previous time
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    try {
      renderer.current ??= new ShaderRenderer(canvas);
      renderer.current.draw(shader, {time, width, height, colors, seed, zoom});
    } catch (err) {
      console.error('[moootion] shader', shader, err);
    }
  }, [shader, time, width, height, colors?.join(','), seed, zoom]);
  return <canvas ref={ref} width={width} height={height} style={{width: '100%', height: '100%', display: 'block', ...style}} />;
};

/** A shader that follows the video frame: time = frame / fps · speed. */
export const ShaderBackground: React.FC<{
  shader: string;
  colors?: string[];
  speed?: number;
  seed?: number;
  /** resolution scale; soft shaders look the same at 0.5 and render faster */
  scale?: number;
  /** pattern size (dither, dot grid) */
  zoom?: number;
}> = ({shader, colors, speed = 1, seed, scale = 1, zoom}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  return (
    <AbsoluteFill>
      <ShaderCanvas
        shader={SHADERS[shader] ? shader : 'mesh'}
        time={(frame / fps) * speed}
        width={Math.round(width * scale)}
        height={Math.round(height * scale)}
        colors={colors}
        seed={seed}
        zoom={zoom}
      />
    </AbsoluteFill>
  );
};

export const backgroundCss = (bg: Extract<Background, {type: 'fill'}>) =>
  bg.colors.length === 1 ? bg.colors[0] : `linear-gradient(${bg.angle ?? 160}deg, ${bg.colors.join(', ')})`;

/**
 * The variant background from the manifest (project.screen.background), or the one passed in.
 * The studio changes it without the agent: the code only places <Backdrop /> at the bottom of the scene.
 */
export const Backdrop: React.FC<{
  background?: Background;
  scale?: number;
}> = ({background, scale}) => {
  const project = useProject();
  const bg = background ?? project?.screen?.background;
  if (!bg) return <AbsoluteFill style={{background: '#000'}} />;
  if (bg.type === 'shader') return <ShaderBackground shader={bg.shader} colors={bg.colors} speed={bg.speed} zoom={bg.zoom} scale={scale} />;
  if (bg.type === 'image') {
    return (
      <AbsoluteFill>
        <Img
          src={asset(bg.file)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: bg.fit ?? 'cover',
          }}
        />
      </AbsoluteFill>
    );
  }
  return <AbsoluteFill style={{background: backgroundCss(bg)}} />;
};
