import {useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Sequence} from 'remotion';
import {ProjectVideo, projectFrames, type Project, type Stages} from '../../../runtime';

/** Each player/thumbnail owns its CSS; project <style> tags must never affect other frames. */
export const StudioComposition: React.FC<{project: Project; stages: Stages; frameOffset?: number; highlight?: {sceneId: string; name: string} | null}> = ({project, stages, frameOffset = 0, highlight}) => {
  const host = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<ShadowRoot | null>(null);
  useLayoutEffect(() => {
    if (host.current) setRoot(host.current.shadowRoot ?? host.current.attachShadow({mode:'open'}));
  }, []);
  return <div ref={host} data-studio-composition style={{position:'absolute',inset:0,isolation:'isolate'}}>
    {root ? createPortal(<>
      {highlight ? <style>{`[data-moootion-scene=${JSON.stringify(highlight.sceneId)}] [data-moootion-layer=${JSON.stringify(highlight.name)}]{outline:2px solid #b4db47;outline-offset:-2px}`}</style> : null}
      <Sequence from={-frameOffset} durationInFrames={projectFrames(project)} layout="none">
      <ProjectVideo project={project} stages={stages} />
    </Sequence></>, root) : null}
  </div>;
};
