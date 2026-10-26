import {useMemo, useRef, useState} from 'react';
import {Thumbnail} from '@remotion/player';
import {IconPlayerPlayFilled} from '@tabler/icons-react';
import type {Group, Project, Scene} from '../../../runtime/manifest';
import {ProjectVideo, projectFrames, type Stages} from '../../../runtime';
import {useAxis, useWheelZoom} from '../axis';
import {snapToFrame, useStudio} from '../store';
import {sec2} from '../format';

const GAP = 11;

/**
 * Cards on the shared time axis: subscenes of the open scene, or one card per scene
 * in «Весь проект» (subscene cards get too thin there to read). Hover scrubs live.
 */
export const SubsceneCards: React.FC = () => {
  const project = useStudio((s) => s.project);
  const stages = useStudio((s) => s.stages);
  const playhead = useStudio((s) => s.playhead);
  const sceneId = useStudio((s) => s.sceneId);
  const axis = useAxis();
  const wheelRef = useRef<HTMLDivElement>(null);
  useWheelZoom(wheelRef);
  const perScene = sceneId === null && (project?.scenes.length ?? 0) > 1;
  // the user sets the height by dragging the divider under the cards
  const cardH = useStudio((s) => s.cardH);
  if (!project || !stages || !axis.view) return <div className="tv cards" ref={wheelRef} style={{height: cardH + 12}} />;

  const items: {scene: Scene; group: Group; off: number; next?: Group}[] = [];
  for (const scene of axis.view.scenes) {
    const off = axis.view.offsets.get(scene.id) ?? 0;
    const whole = {id: `${scene.id}-all`, title: scene.title, from: 0, to: scene.duration};
    const groups = perScene || !scene.groups.length ? [whole] : scene.groups;
    groups.forEach((g, i) => items.push({scene, group: g, off, next: groups[i + 1]}));
  }

  return (
    <div className="tv cards" ref={wheelRef} style={{height: cardH + 12}}>
      <div className="tv-inner">
        {items.map(({scene, group, off, next}) => (
          <Card key={`${scene.id}/${group.id}`} project={project} stages={stages} scene={scene} group={group} off={off} next={next} cardH={cardH} />
        ))}
        <div className="playhead thin" style={{left: axis.x(playhead), top: -14, bottom: 12}} />
      </div>
    </div>
  );
};

const Card: React.FC<{
  project: Project;
  stages: Stages;
  scene: Scene;
  group: Group;
  off: number;
  next?: Group;
  cardH: number;
}> = ({project, stages, scene, group, off, next, cardH: CARD_H}) => {
  const axis = useAxis();
  const setPlayhead = useStudio((s) => s.setPlayhead);
  const playStretch = useStudio((s) => s.playStretch);
  const playhead = useStudio((s) => s.playhead);
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const x0 = axis.x(off + group.from);
  const x1 = axis.x(off + group.to);
  const left = x0 + GAP / 2;
  const width = Math.max(40, x1 - x0 - GAP);
  const active = playhead >= off + group.from && playhead < off + group.to;

  // cover-fit the 16:9 frame into the card
  const tw = Math.max(width, (CARD_H * project.width) / project.height);
  const th = (tw * project.height) / project.width;

  const fps = project.fps;
  const total = projectFrames(project);
  const idleT = off + (group.from + group.to) / 2;
  const showT = hover ?? idleT;
  const frame = Math.min(total - 1, Math.max(0, Math.round(showT * fps)));
  const inputProps = useMemo(() => ({project, stages}), [project, stages]);

  const timeAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const k = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return snapToFrame(off + group.from + k * (group.to - group.from), fps);
  };

  return (
    <>
      <div
        ref={ref}
        className={`card ${active ? 'active' : ''} ${width < 96 ? 'tiny' : width < 170 ? 'narrow' : ''}`}
        style={{left, width, height: CARD_H, borderRadius: Math.min(51, Math.round(CARD_H * 0.24))}}
        title={`${group.title} · ${sec2(group.from)}–${sec2(group.to)} с`}
        onMouseMove={(e) => setHover(timeAt(e.clientX))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => setPlayhead(timeAt(e.clientX))}
      >
        <div className="card-thumb" style={{left: (width - tw) / 2, top: (CARD_H - th) / 2, width: tw, height: th}}>
          <Thumbnail
            component={ProjectVideo}
            inputProps={inputProps}
            compositionWidth={project.width}
            compositionHeight={project.height}
            durationInFrames={total}
            fps={fps}
            frameToDisplay={frame}
            style={{width: tw, height: th}}
          />
        </div>
        <div className="card-shade" />
        <button
          type="button"
          className="card-icon"
          title={`Проиграть «${group.title}» в превью`}
          onClick={(e) => {
            e.stopPropagation();
            playStretch(off + group.from, off + group.to);
          }}
        >
          <IconPlayerPlayFilled size={12} />
        </button>
        {hover !== null ? (
          <div className="card-scrub" style={{left: ((hover - off - group.from) / (group.to - group.from)) * width}}>
            <span>{sec2(hover - off)} с</span>
          </div>
        ) : null}
        <div className="card-text">
          <small>
            {sec2(off + group.from)} – {sec2(off + group.to)} с
          </small>
          <b>{group.title}</b>
        </div>
      </div>
      {next ? <Join scene={scene} group={group} off={off} /> : null}
    </>
  );
};

/** Yellow seam between subscenes; drag it to move the boundary (display only). */
const Join: React.FC<{scene: Scene; group: Group; off: number}> = ({scene, group, off}) => {
  const axis = useAxis();
  const edit = useStudio((s) => s.edit);
  const checkpoint = useStudio((s) => s.checkpoint);
  const fps = useStudio((s) => s.project?.fps ?? 60);

  const down = (e: React.PointerEvent) => {
    e.stopPropagation();
    const parent = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
    checkpoint();
    const move = (ev: PointerEvent) => {
      const t = snapToFrame(axis.t(ev.clientX - parent.left) - off, fps);
      edit(
        (p) => {
          const s = p.scenes.find((x) => x.id === scene.id)!;
          const i = s.groups.findIndex((g) => g.id === group.id);
          const a = s.groups[i];
          const b = s.groups[i + 1];
          if (!a || !b) return;
          const v = Math.min(b.to - 0.2, Math.max(a.from + 0.2, t));
          a.to = v;
          b.from = v;
        },
        {history: false},
      );
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return <div className="join" style={{left: axis.x(off + group.to)}} onPointerDown={down} title="Граница субсцен — перетащите" />;
};

/**
 * The divider between the cards and the actions: drag it down for taller thumbnails,
 * up for more rows. The ruler, the duration and the title keep their size.
 */
export const CardsGrip: React.FC = () => {
  const cardH = useStudio((s) => s.cardH);
  const setCardH = useStudio((s) => s.setCardH);
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    const y0 = e.clientY;
    const h0 = cardH;
    document.body.classList.add('resizing-rows');
    const move = (ev: PointerEvent) => setCardH(h0 + ev.clientY - y0);
    const up = () => {
      document.body.classList.remove('resizing-rows');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return <div className="cards-grip" onPointerDown={down} onDoubleClick={() => setCardH(180)} title="Потяните, чтобы изменить высоту превью (двойной клик — по умолчанию)" />;
};
