import {connectionFailure, type ConnectionStatus} from '../runtime/connection-status';

export function connectionFeedback(publish: (status: ConnectionStatus) => void, now = Date.now) {
  let retrying = false;
  return {
    error(message: string, willRetry: boolean) {
      retrying = willRetry;
      const text = willRetry
        ? 'Codex сообщил об ошибке соединения или запроса и пытается восстановить работу. Повторный запуск пока не нужен.'
        : connectionFailure('Codex', message);
      publish({service:'Codex', state:willRetry ? 'retrying' : 'failed', message:text, at:now()});
      return text;
    },
    activity() {
      if (!retrying) return;
      retrying = false;
      publish({service:'Codex',state:'connected',message:'Codex снова отвечает. Работа продолжается.',at:now()});
    },
    async connector<T extends {isError?: boolean}>(service: 'Figma'|'Magnific', tool: string, call: () => Promise<T>) {
      publish({service,state:'waiting',message:`Ожидаю ответ ${service}: ${tool}. Таймаут запроса — до 3 минут.`,at:now()});
      try {
        const result = await call();
        publish({service,state:result.isError ? 'failed' : 'connected',message:result.isError ? `${service}: сервис вернул ошибку ${tool}. Агент получил ошибку; результат не готов.` : `${service}: ответ ${tool} получен.`,at:now()});
        return result;
      } catch (e) {
        publish({service,state:'failed',message:connectionFailure(service,e instanceof Error ? e.message : String(e)),at:now()});
        throw e;
      }
    },
  };
}
