import {isVariants, projectFrames, sceneFrames, type Project} from '../../runtime/manifest';

/** Bound playback without rewriting the composition or its global clock. */
export const previewRange = (project: Project, sceneId: string | null) => {
  const total = projectFrames(project);
  let from = 0;
  if (isVariants(project) && sceneId) {
    for (const scene of project.scenes) {
      const frames = sceneFrames(scene, project.fps);
      if (scene.id === sceneId) return {from, to: from + frames - 1, total, bounded: true};
      from += frames;
    }
  }
  return {from: 0, to: total - 1, total, bounded: false};
};
