import {ensureExecutor} from './executor-startup';
import {codexStatus} from './codex';
import {codexConnectorsStatus} from './codex-connectors';

/** Prepare tools without starting generation or prompting for account login. */
export async function prepareStudioTools() {
  const results = await Promise.allSettled([
    ensureExecutor(),
    (async () => {
      const status = await codexStatus();
      console.log(`[startup] Codex: ${status.cli && status.login ? 'авторизован' : 'нужно проверить установку или вход в настройках студии'}`);
      if (!status.cli || !status.login) return;
      const connectors = await codexConnectorsStatus(true);
      for (const connector of connectors.connectors) console.log(`[startup] ${connector.name}: ${connector.status}`);
    })(),
  ]);
  for (const result of results) if (result.status === 'rejected') console.error('[startup] Проверка инструментов не завершена:', result.reason instanceof Error ? result.reason.message : String(result.reason));
}
