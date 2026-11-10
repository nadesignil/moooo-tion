import fs from 'node:fs/promises';
import {correctiveContract} from './corrective-contract';
import {studioContract} from './agent-prompt';

export type CodexGuidance = 'legacy' | 'corrective' | 'method-13';

/** Production guidance is independent of model names. Explicit experiment overrides win. */
export const resolveCodexGuidance = (_model: string, override?: unknown): CodexGuidance => {
  if (override !== undefined) {
    if (override === 'legacy' || override === 'corrective' || override === 'method-13') return override;
    throw new Error('Неизвестный профиль инструкций Codex: ' + String(override));
  }
  return 'method-13';
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
