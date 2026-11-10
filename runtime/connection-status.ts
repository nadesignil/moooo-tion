/** Observed connection state, never inferred from silent model reasoning. */
export type ConnectionStatus = {
  service: 'Codex' | 'Figma' | 'Magnific' | 'Студия';
  state: 'waiting' | 'retrying' | 'failed' | 'connected';
  message: string;
  at: number;
};

export function connectionFailure(service: ConnectionStatus['service'], error: string): string {
  if (/workspace routing discovery failed/i.test(error)) return 'Codex не смог подключиться к сервису генерации. Запуск прерван. Попробуйте запустить задачу снова.';
  if (/не ответил|timeout|timed out/i.test(error)) return `${service}: время ожидания ответа истекло. Результат запроса не получен; это не подтверждает потерю интернета.`;
  if (/соединение.*закрыто|disconnect|connection.*closed|ECONNRESET|ENOTFOUND|fetch failed|network/i.test(error)) return `Связь с ${service} потеряна. Результат запроса не получен.`;
  return `${service}: запрос завершился ошибкой. ${error.slice(0, 300)}`;
}
