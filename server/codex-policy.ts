/** Quality-first studio default, verified against the live account catalog on every run.
 * Official guidance: https://learn.chatgpt.com/docs/models
 * Global CLI defaults do not choose the studio's production model.
 */
export const DEFAULT_CODEX_MODEL = 'gpt-6-astra';
type Model = {model: string; supportedReasoningEfforts?: {reasoningEffort: string}[]};
type Profile = {model?: unknown; reasoningEffort?: unknown};
const SINGLE_AGENT_EFFORTS = ['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none'];

export const selectCodexPolicy = (models: Model[], profile: Profile = {}) => {
  const model = profile.model ?? DEFAULT_CODEX_MODEL;
  const entry = typeof model === 'string' ? models.find(m => m.model === model) : undefined;
  if (!entry) throw new Error(`Модель Codex недоступна: ${String(model)}. Автоматическая замена отключена.`);
  const supported = new Set(entry.supportedReasoningEfforts?.map(e => e.reasoningEffort));
  const effort = profile.reasoningEffort ?? SINGLE_AGENT_EFFORTS.find(e => supported.has(e));
  // Ultra delegates to subagents; this integration exposes only project-scoped tools to one agent.
  if (typeof effort !== 'string' || !SINGLE_AGENT_EFFORTS.includes(effort) || !supported.has(effort)) {
    throw new Error(`Недоступный уровень рассуждения Codex: ${String(effort)} для ${model}`);
  }
  return {model: entry.model, effort, source: profile.model === undefined ? 'studio-default' : 'project-override'};
};

export const readCodexPolicy = async (client: {request: (method: string, params: unknown) => Promise<any>}, profile: Profile = {}) => {
  const models: Model[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await client.request('model/list', {limit: 100, ...(cursor ? {cursor} : {})});
    if (!Array.isArray(page.data)) throw new Error('Codex вернул некорректный каталог моделей');
    models.push(...page.data);
    cursor = page.nextCursor ?? undefined;
    if (cursor && seen.has(cursor)) throw new Error('Codex повторил страницу каталога моделей');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return selectCodexPolicy(models, profile);
};
