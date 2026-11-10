import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT} from './paths';
import {createProjectGit} from './project-history-git';

const history = createProjectGit(ROOT);
const git = history.run;
const ensureIdentity = history.ensure;
const rel = history.relative;

/** commit the project folder (even if nothing changed) and return the commit hash */
export const snapshot = async (projectId: string, message: string) => {
  await ensureIdentity();
  await git(['add', '-A', '--', rel(projectId)]);
  await git(['commit', '--allow-empty', '-m', message, '--', rel(projectId)]).catch(async () => {
    // first commit in the repo, or nothing staged — fall back to an empty commit
    await git(['commit', '--allow-empty', '-m', message]);
  });
  return git(['rev-parse', 'HEAD']);
};

/** restore the project folder to a commit and record that as a new commit */
export const restore = async (projectId: string, commit: string, message: string) => {
  await ensureIdentity();
  await git(['checkout', commit, '--', rel(projectId)]);
  // files created after `commit` must go too
  const added = await git(['diff', '--name-only', '--diff-filter=A', commit, 'HEAD', '--', rel(projectId)]).catch(() => '');
  for (const f of added.split('\n').filter(Boolean)) await git(['rm', '-q', '--', f]).catch(() => undefined);
  return snapshot(projectId, message);
};

/**
 * `detail` says what the version holds in plain words (two lines in the menu);
 * `files` is what the snapshot changed compared to the one before it.
 */
export type Version = {hash: string; at: string; message: string; detail?: string; files?: string; current: boolean};

/** the agent jobs of a project: their snapshots get the task and the agent's own summary */
const jobsByCommit = async (projectId: string) => {
  const fs = await import('node:fs/promises');
  const dir = path.join(ROOT, 'projects', projectId, '.moootion', 'jobs');
  const map = new Map<string, {role: 'before' | 'after'; title: string; summary?: string}>();
  for (const f of await fs.readdir(dir).catch(() => [] as string[])) {
    try {
      const j = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')) as {
        title: string;
        summary?: string;
        commitBefore?: string;
        commitAfter?: string;
      };
      if (j.commitBefore) map.set(j.commitBefore, {role: 'before', title: j.title});
      if (j.commitAfter) map.set(j.commitAfter, {role: 'after', title: j.title, summary: j.summary});
    } catch {
      // unreadable job file
    }
  }
  return map;
};

/** the first sentences of a text, up to ~170 characters, without markdown */
const gist = (text: string) => {
  const flat = text
    .replace(/\*\*|`|#+ /g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length <= 170) return flat;
  const cut = flat.slice(0, 170);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return end > 80 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
};

/** «код: 3 файла · манифест» — what a snapshot changed inside the project */
const changedFiles = async (projectId: string, hash: string) => {
  const out = await git(['show', '--name-only', '--format=', hash, '--', rel(projectId)]).catch(() => '');
  const files = out.split('\n').filter(Boolean);
  if (!files.length) return 'без изменений';
  const code = files.filter((f) => /\/src\//.test(f)).length;
  const manifest = files.some((f) => f.endsWith('/project.json'));
  const assets = files.filter((f) => /\/(public|inputs)\//.test(f)).length;
  const parts: string[] = [];
  if (code) parts.push(`код: ${code} ${code === 1 ? 'файл' : code < 5 ? 'файла' : 'файлов'}`);
  if (manifest) parts.push('тайминги и параметры');
  if (assets) parts.push(`ассеты: ${assets}`);
  return parts.join(' · ') || 'служебные файлы';
};

// git log fields and records are separated by the ASCII unit / record separators
const US = String.fromCharCode(0x1f);
const RS = String.fromCharCode(0x1e);

/** every snapshot of the project, newest first; `current` = the working folder matches it */
export const listVersions = async (projectId: string): Promise<{dirty: boolean; versions: Version[]}> => {
  await ensureIdentity();
  const out = await git(['log', '-n', '200', '--format=%H%x1f%cI%x1f%s%x1f%b%x1e', '--', rel(projectId)]).catch(() => '');
  const jobs = await jobsByCommit(projectId);
  const list: Version[] = [];
  for (const rec of out.split(RS).map((r) => r.trim()).filter(Boolean)) {
    const [hash, at, message, body = ''] = rec.split(US);
    const job = jobs.get(hash);
    let detail = body.trim() || undefined;
    if (job?.role === 'after' && job.summary) detail = gist(job.summary);
    else if (job?.role === 'before') detail = `Состояние перед задачей: ${gist(job.title)}`;
    list.push({hash, at, message, detail, current: false});
  }
  // file stats for the recent ones (each is one git call)
  await Promise.all(list.slice(0, 40).map(async (v) => (v.files = await changedFiles(projectId, v.hash))));
  const dirty = Boolean(await git(['status', '--porcelain', '--', rel(projectId)]).catch(() => 'x'));
  if (list.length && !dirty) list[0].current = true;
  return {dirty, versions: list};
};

/** switch the project to a version; the current state is saved first, so nothing is lost */
export const switchVersion = async (projectId: string, hash: string, label: string) => {
  await ensureIdentity();
  await git(['cat-file', '-e', `${hash}^{commit}`]);
  const dirty = await git(['status', '--porcelain', '--', rel(projectId)]).catch(() => '');
  if (dirty) await snapshot(projectId, 'версия: правки перед переключением');
  return restore(projectId, hash, `версия: переключение на «${label}»`);
};
