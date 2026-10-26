import fs from 'node:fs/promises';
import path from 'node:path';
import {ProjectSchema, projectFrames, type Project} from '../runtime/manifest';
import {PROJECTS, TRASH, projectDir} from './paths';

export type ProjectSummary = {
  id: string;
  title: string;
  scenes: number;
  seconds: number;
  updatedAt: string;
  cover: string | null;
};

const manifestPath = (id: string) => path.join(projectDir(id), 'project.json');

export const readProject = async (id: string): Promise<Project> => {
  const raw = JSON.parse(await fs.readFile(manifestPath(id), 'utf8'));
  return ProjectSchema.parse(raw);
};

export const writeProject = async (id: string, data: unknown): Promise<Project> => {
  const project = ProjectSchema.parse(data);
  if (project.id !== id) throw new Error('project id mismatch');
  const file = manifestPath(id);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(project, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, file);
  return project;
};

export const listProjects = async (): Promise<ProjectSummary[]> => {
  const entries = await fs.readdir(PROJECTS, {withFileTypes: true}).catch(() => []);
  const out: ProjectSummary[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      const p = await readProject(e.name);
      const stat = await fs.stat(manifestPath(e.name));
      const coverFile = path.join(projectDir(e.name), '.moootion', 'cover.jpg');
      const hasCover = await fs
        .access(coverFile)
        .then(() => true)
        .catch(() => false);
      out.push({
        id: p.id,
        title: p.title,
        scenes: p.scenes.length,
        seconds: projectFrames(p) / p.fps,
        updatedAt: stat.mtime.toISOString(),
        cover: hasCover ? `/files/${p.id}/.moootion/cover.jpg` : null,
      });
    } catch {
      // not a project folder
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

/** what a copy leaves behind: the agent's chat, run logs and scratch files belong to the original */
const NOT_COPIED = ['.moootion/chat.json', '.moootion/jobs', '.moootion/check', '.moootion/tmp', 'out'];

/** a full copy under a new id: code, assets, inputs, versions of the manifest; the chat starts empty */
export const duplicateProject = async (id: string, newId: string, title: string) => {
  const src = projectDir(id);
  await fs.cp(src, projectDir(newId), {
    recursive: true,
    filter: (f) => {
      const rel = path.relative(src, f).split(path.sep).join('/');
      return !NOT_COPIED.some((x) => rel === x || rel.startsWith(`${x}/`));
    },
  });
  const p = await readProject(newId);
  return writeProject(newId, {...p, id: newId, title});
};

/** moves the folder to trash/<id>-<time>; git history keeps it too */
export const trashProject = async (id: string) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await fs.mkdir(TRASH, {recursive: true});
  const to = path.join(TRASH, `${id}-${stamp}`);
  try {
    await fs.rename(projectDir(id), to);
  } catch (err) {
    // Windows: a folder the dev server watches cannot be renamed — copy it, then remove the original
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw err;
    await fs.cp(projectDir(id), to, {recursive: true});
    await fs.rm(projectDir(id), {recursive: true, force: true, maxRetries: 8, retryDelay: 250});
  }
  return to;
};
