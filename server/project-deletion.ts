import fs from 'node:fs/promises';
import path from 'node:path';

export type ProjectStorage = {projects: string; renders: string[]; trash: string; caches?: string[]};
export const renderBelongsToProject = (file: string, id: string) =>
  new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d{13}(?:-[^/\\\\]+)?\\.mp4$`).test(file);

async function entries(root: string) {
  try {
    if ((await fs.lstat(root)).isSymbolicLink()) throw new Error('Storage root must not be a symlink');
    return await fs.readdir(root, {withFileTypes: true});
  } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
}
function child(root: string, name: string) {
  const base = path.resolve(root), target = path.resolve(base, name);
  if (path.dirname(target) !== base || target === base) throw new Error('Invalid deletion path');
  return target;
}

/** Permanent deletion. Matches exact ownership, never another project with the same prefix. */
export async function deleteProjectFiles(id: string, storage: ProjectStorage) {
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(id)) throw new Error('Invalid project id');
  await entries(storage.projects);
  const project = child(storage.projects, id);
  const renders: string[] = [], archived: string[] = [];
  for (const root of storage.renders) {
    for (const file of await entries(root)) {
      if (file.isFile() && renderBelongsToProject(file.name, id)) renders.push(child(root, file.name));
    }
  }
  for (const dir of await entries(storage.trash)) {
    if (!dir.isDirectory() || !dir.name.startsWith(id + '-') || !/^\d{4}-\d{2}-\d{2}T/.test(dir.name.slice(id.length + 1))) continue;
    const target = child(storage.trash, dir.name);
    const manifest = await fs.readFile(path.join(target, 'project.json'), 'utf8').then(JSON.parse).catch(() => null);
    if (manifest?.id === id) archived.push(target);
  }
  const caches: string[] = [];
  for (const root of storage.caches ?? []) { await entries(root); caches.push(child(root, id)); }
  // Keep the project visible if ancillary cleanup fails, so the operation can be retried.
  for (const file of renders) await fs.rm(file, {force: true});
  for (const dir of archived) await fs.rm(dir, {recursive: true, force: true, maxRetries: 8, retryDelay: 250});
  for (const dir of caches) await fs.rm(dir, {recursive: true, force: true, maxRetries: 8, retryDelay: 250});
  await fs.rm(project, {recursive: true, force: true, maxRetries: 8, retryDelay: 250});
  return {removedRenders: renders.length, removedArchives: archived.length};
}
