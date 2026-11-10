import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec = promisify(execFile);

/** New installs keep video snapshots out of the source repository. Existing project history stays readable. */
export const createProjectGit = (root: string) => {
  const privateDir = path.join(root, '.moootion', 'history.git');
  const workTree = path.join(root, 'projects');
  let legacy = false;
  let initialized: Promise<void> | undefined;
  const raw = async (prefix: string[], args: string[]) => {
    const {stdout} = await exec('git', [...prefix, ...args], {maxBuffer: 10 * 1024 * 1024, windowsHide: true});
    return stdout.trim();
  };
  const prefix = () => legacy ? ['-C', root] : ['--git-dir=' + privateDir, '--work-tree=' + workTree, '-c', 'core.bare=false'];
  const initialize = async () => {
    const privateExists = Boolean(await fs.stat(privateDir).catch(() => null));
    if (!privateExists && await fs.stat(path.join(root, '.git')).catch(() => null)) {
      // Only the app's own repository is eligible, never an ancestor repository.
      legacy = Boolean(await raw(['-C', root], ['log', '-1', '--format=%H', '--', 'projects']).catch(() => ''));
    }
    if (!legacy) {
      await fs.mkdir(workTree, {recursive: true});
      await fs.mkdir(path.dirname(privateDir), {recursive: true});
      if (!privateExists) await raw([], ['init', '--bare', '-q', privateDir]);
      await fs.mkdir(path.join(privateDir, 'info'), {recursive: true});
      // The worktree starts at projects/: the source .gitignore cannot hide all project files.
      // Local chats, sessions and caches remain excluded from snapshots as before.
      await fs.writeFile(path.join(privateDir, 'info', 'exclude'), '.moootion/\nnode_modules/\n.git\n*.tmp\n');
    }
    await raw(prefix(), ['config', 'core.autocrlf', 'false']);
    const name = await raw(prefix(), ['config', 'user.name']).catch(() => '');
    if (!name) {
      await raw(prefix(), ['config', 'user.name', 'Moootion Studio']);
      await raw(prefix(), ['config', 'user.email', 'studio@moootion.local']);
    }
  };
  const ensure = () => initialized ??= initialize().catch(error => {initialized = undefined; throw error;});
  const relative = (projectId: string) => {
    if (!/^[a-z0-9][a-z0-9-_]*$/i.test(projectId)) throw new Error('bad project id');
    return legacy ? path.posix.join('projects', projectId) : projectId;
  };
  return {
    ensure,
    relative,
    run: async (args: string[]) => {await ensure(); return raw(prefix(), args);},
  };
};
