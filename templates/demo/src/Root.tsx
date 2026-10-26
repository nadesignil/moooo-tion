import {Composition} from 'remotion';
import manifest from '../project.json';
import {ProjectVideo, projectFrames, type Project} from './moootion';
import {stages} from './project';

const Video: React.FC<{project: Project}> = ({project}) => <ProjectVideo project={project} stages={stages} />;

export const Root: React.FC = () => (
  <Composition
    id="Project"
    component={Video}
    defaultProps={{project: manifest as unknown as Project}}
    durationInFrames={projectFrames(manifest as unknown as Project)}
    fps={manifest.fps}
    width={manifest.width}
    height={manifest.height}
    calculateMetadata={({props}) => ({
      durationInFrames: projectFrames(props.project),
      fps: props.project.fps,
      width: props.project.width,
      height: props.project.height,
    })}
  />
);
