import fs from 'node:fs/promises';
import path from 'node:path';
import {bundle} from '@remotion/bundler';
import {renderMedia, renderStill, selectComposition} from '@remotion/renderer';
import {sceneFrames} from '../runtime/manifest';
import {readProject} from './projects';
import {slugify} from './scaffold';
import {RENDERS, projectDir} from './paths';

/**
 * Headless Chrome's default GL mode draws a WebGL canvas (the shader backgrounds) with a black band where a zoomed
 * layer covers it; ANGLE draws it right on every platform.
 */
export const CHROMIUM = {gl: 'angle' as const};

export type RenderJob = {
  id: string;
  projectId: string;
  status: 'bundling' | 'rendering' | 'done' | 'error';
  progress: number;
  file?: string;
  url?: string;
  /** a single variant (scene) of a «screen» project; absent = the whole video */
  sceneId?: string;
  error?: string;
  startedAt: string;
};

const jobs = new Map<string, RenderJob>();

export const getRenderJob = (projectId: string) => jobs.get(projectId) ?? null;

export const startRender = async (projectId: string, sceneId?: string): Promise<RenderJob> => {
  const running = jobs.get(projectId);
  if (running && (running.status === 'bundling' || running.status === 'rendering')) return running;

  const job: RenderJob = {
    id: `${projectId}-${Date.now()}`,
    projectId,
    status: 'bundling',
    progress: 0,
    startedAt: new Date().toISOString(),
    ...(sceneId ? {sceneId} : {}),
  };
  jobs.set(projectId, job);

  (async () => {
    try {
      const dir = projectDir(projectId);
      const project = await readProject(projectId);
      const serveUrl = await bundle({
        entryPoint: path.join(dir, 'src', 'index.ts'),
        publicDir: path.join(dir, 'public'),
      });
      const inputProps = {project};
      const composition = await selectComposition({serveUrl, id: 'Project', inputProps, chromiumOptions: CHROMIUM});
      // one variant = the frames of its scene
      let frameRange: [number, number] | undefined;
      let suffix = '';
      if (sceneId) {
        let from = 0;
        for (const s of project.scenes) {
          const dur = sceneFrames(s, project.fps);
          if (s.id === sceneId) {
            frameRange = [from, from + dur - 1];
            suffix = `-${slugify(s.title)}`;
            break;
          }
          from += dur;
        }
        if (!frameRange) throw new Error(`Нет варианта ${sceneId}`);
      }
      job.status = 'rendering';
      await fs.mkdir(RENDERS, {recursive: true});
      const file = path.join(RENDERS, `${job.id}${suffix}.mp4`);
      await renderMedia({
        serveUrl,
        chromiumOptions: CHROMIUM,
        composition,
        inputProps,
        codec: 'h264',
        crf: 14,
        imageFormat: 'jpeg',
        jpegQuality: 95,
        pixelFormat: 'yuv420p',
        concurrency: 6,
        ...(frameRange ? {frameRange} : {}),
        outputLocation: file,
        onProgress: ({progress}) => {
          job.progress = progress;
        },
      });
      job.status = 'done';
      job.progress = 1;
      job.file = file;
      job.url = `/renders/${path.basename(file)}`;
    } catch (err) {
      job.status = 'error';
      job.error = err instanceof Error ? err.message : String(err);
    }
  })();

  return job;
};

/** small cover for the project list: a frame at 40 % of the video */
export const renderCover = async (projectId: string) => {
  const dir = projectDir(projectId);
  const project = await readProject(projectId);
  const serveUrl = await bundle({entryPoint: path.join(dir, 'src', 'index.ts'), publicDir: path.join(dir, 'public')});
  const inputProps = {project};
  const composition = await selectComposition({serveUrl, id: 'Project', inputProps, chromiumOptions: CHROMIUM});
  const output = path.join(dir, '.moootion', 'cover.jpg');
  await fs.mkdir(path.dirname(output), {recursive: true});
  await renderStill({
    serveUrl,
    chromiumOptions: CHROMIUM,
    composition,
    inputProps,
    output,
    frame: Math.floor(composition.durationInFrames * 0.4),
    imageFormat: 'jpeg',
    jpegQuality: 85,
    scale: 320 / composition.width,
  });
};
