export type Provider = 'claude' | 'codex';
export function normalizeProvider(value?: unknown): Provider | null;
export function detectProvider(env?: NodeJS.ProcessEnv): Provider | null;
export function resolveProvider(options?: {explicit?: string; saved?: string; env?: NodeJS.ProcessEnv}): Provider | null;
export function readJson(file: string, fallback?: any): Promise<any>;
export function saveJson(file: string, value: unknown): Promise<void>;
export function initializeProvider(root: string, options?: {explicit?: string; env?: NodeJS.ProcessEnv}): Promise<Provider | null>;
