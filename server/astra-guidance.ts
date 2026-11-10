import fs from 'node:fs/promises';
import {correctiveContract} from './corrective-contract';
import {studioContract} from './agent-prompt';

export type CodexGuidance = 'legacy' | 'corrective' | 'method-13';

/** A project override wins; account models outside Astra retain their existing instructions. */
export const resolveCodexGuidance = (model: string, override?: unknown): CodexGuidance => {
  if (override !== undefined) {
    if (override === 'legacy' || override === 'corrective' || override === 'method-13') return override;
    throw new Error('Неизвестный профиль инструкций Codex: ' + String(override));
  }
  return /(?:^|-)astra(?:-|$)/i.test(model) ? 'method-13' : 'legacy';
};

export const codexGuidanceContract = async (projectId: string, original: string, guidance: CodexGuidance) => {
  if (guidance === 'legacy') return original;
  const technical = correctiveContract(projectId);
  if (guidance === 'corrective') return technical;
  const method = await fs.readFile(new URL('../rules/astra-method-13.md', import.meta.url), 'utf8');
  // jobs.ts appends this project's settings, assets, Figma context and chat after the base contract.
  // Preserve that data while replacing only the old creative instructions.
  const originalBase = studioContract(projectId);
  const projectContext = original.startsWith(originalBase) ? original.slice(originalBase.length) : '';
  return technical + '\n' + method + projectContext;
};
