import fs from 'node:fs/promises';
import path from 'node:path';
const within = (root: string, target: string) => {
  const rel = path.relative(root, target);
  return !rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
};
/** Both lexical and real paths are checked (junctions/symlinks cannot escape). */
export const scopedPath = async (root: string, file: string, write = false) => {
  const base = await fs.realpath(root);
  const dest = path.resolve(root, file);
  if (!within(root, dest)) throw new Error('Файл вне папки проекта');
  let cursor = dest;
  for (;;) {
    try {
      const actual = await fs.realpath(cursor);
      if (!within(base, actual)) throw new Error('Ссылка ведёт за пределы проекта');
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT' || !write || cursor === root) throw e;
      cursor = path.dirname(cursor);
    }
  }
  return dest;
};
