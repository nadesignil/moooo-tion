import {execFile} from 'node:child_process';
import type {Action, Project} from '../runtime/manifest';
import {ROOT} from './paths';

const gitShow = (spec: string) =>
  new Promise<string | null>((resolve) => {
    execFile('git', ['-C', ROOT, 'show', spec], {maxBuffer: 20 * 1024 * 1024}, (err, out) => resolve(err ? null : out));
  });

/** the manifest as the agent last left it (last commit touching the project) */
export const lastCommittedManifest = async (projectId: string): Promise<Project | null> => {
  const raw = await gitShow(`HEAD:projects/${projectId}/project.json`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Project;
  } catch {
    return null;
  }
};

const n = (v: number) => v.toFixed(2).replace('.', ',');
const curveText = (a: Action) => (a.curve.type === 'bezier' ? `bezier(${a.curve.v.join(', ')})` : `пружина d${a.curve.damping} s${a.curve.stiffness}`);

/** human list of live edits made in the studio since the agent's last version */
export const describeLiveEdits = (before: Project | null, now: Project, sceneId: string | null) => {
  if (!before) return '';
  const lines: string[] = [];
  for (const scene of now.scenes) {
    if (sceneId && scene.id !== sceneId) continue;
    const old = before.scenes.find((s) => s.id === scene.id);
    if (!old) continue;
    if (old.duration !== scene.duration) lines.push(`Сцена «${scene.title}»: длительность ${n(old.duration)} → ${n(scene.duration)} с`);
    for (const g of scene.groups) {
      const og = old.groups.find((x) => x.id === g.id);
      if (og && (og.from !== g.from || og.to !== g.to)) {
        lines.push(`Субсцена «${g.title}»: ${n(og.from)}–${n(og.to)} → ${n(g.from)}–${n(g.to)} с`);
      }
    }
    for (const a of scene.actions) {
      const o = old.actions.find((x) => x.id === a.id);
      if (!o) continue;
      const parts: string[] = [];
      if (o.title !== a.title) parts.push(`название «${o.title}» → «${a.title}»`);
      if (o.start !== a.start) parts.push(`начало ${n(o.start)} → ${n(a.start)} с`);
      if (o.duration !== a.duration) parts.push(`длина ${n(o.duration)} → ${n(a.duration)} с`);
      if (JSON.stringify(o.curve) !== JSON.stringify(a.curve)) parts.push(`кривая ${curveText(o)} → ${curveText(a)}`);
      for (const [k, v] of Object.entries(a.params ?? {})) {
        const ov = o.params?.[k];
        if (ov !== v) parts.push(`${k}: ${String(ov)} → ${String(v)}`);
      }
      if (parts.length) lines.push(`«${a.title}» (${a.id}): ${parts.join('; ')}`);
    }
  }
  return lines.map((l) => `- ${l}`).join('\n');
};
