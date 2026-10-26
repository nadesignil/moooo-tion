import path from 'node:path';
import os from 'node:os';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const PROJECTS = path.join(ROOT, 'projects');
export const RENDERS = path.join(ROOT, 'renders');
/** shared library: mockups, later techniques and effects */
export const LIBRARY = path.join(ROOT, 'library');
/** deleted projects land here, not in the void */
export const TRASH = path.join(ROOT, 'trash');
export const CLAUDE_HOME = path.join(os.homedir(), '.claude');

export const projectDir = (id: string) => {
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(id)) throw new Error(`bad project id: ${id}`);
  return path.join(PROJECTS, id);
};
