// Loads a project's stage components (the agent-written code) into the studio.
// Imported by path through Vite's /@fs/ so projects created at runtime work too;
// Vite watches the files, so the agent's edits hot-reload into the Player.
import type {Stages} from '../../runtime/timeline';

declare const __MOOOTION_ROOT__: string;

/**
 * A browser remembers a failed dynamic import by its URL until the page reloads: once project.tsx failed (the agent
 * listed a scene before writing its file), every later import of the same URL fails at once, even with the files in
 * place. After a failure the next try asks for a new URL, so the browser fetches the module again.
 */
const failures = new Map<string, number>();

export const loadStages = async (projectId: string): Promise<Stages> => {
  const retry = failures.get(projectId) ?? 0;
  const url = `/@fs/${__MOOOTION_ROOT__}/projects/${projectId}/src/project.tsx${retry ? `?retry=${retry}` : ''}`;
  let mod: {stages?: Stages};
  try {
    mod = (await import(/* @vite-ignore */ url)) as {stages?: Stages};
  } catch (err) {
    failures.set(projectId, retry + 1);
    throw new Error(`Не удалось загрузить код проекта «${projectId}»: ${(err as Error).message}`);
  }
  if (!mod.stages) throw new Error(`В проекте «${projectId}» src/project.tsx не экспортирует stages`);
  // assets of this project are served by the studio server
  (globalThis as unknown as {__MOOOTION_ASSET_BASE__: string}).__MOOOTION_ASSET_BASE__ = `/files/${projectId}/`;
  return mod.stages;
};
