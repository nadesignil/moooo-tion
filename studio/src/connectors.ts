import {useEffect, useState} from 'react';
import {api, type ConnectorsStatus} from './api';

/** One probe per page load (the server caches it too); «Проверить» forces a fresh one. */
let cached: Promise<ConnectorsStatus> | null = null;
const listeners = new Set<(s: ConnectorsStatus | null) => void>();

const load = (fresh: boolean) => {
  cached = api.connectors(fresh).catch(
    (err): ConnectorsStatus => ({at: new Date().toISOString(), model: '', connectors: [], error: err instanceof Error ? err.message : String(err)}),
  );
  listeners.forEach((l) => l(null));
  cached.then((s) => listeners.forEach((l) => l(s)));
  return cached;
};

export const refreshConnectors = () => load(true);

export const useConnectors = () => {
  const [status, setStatus] = useState<ConnectorsStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const on = (s: ConnectorsStatus | null) => alive && setStatus(s);
    listeners.add(on);
    (cached ?? load(false)).then(on);
    return () => {
      alive = false;
      listeners.delete(on);
    };
  }, []);
  return status;
};

export const connectorLabel = (status: string) =>
  status === 'connected'
    ? 'подключён'
    : status === 'needs-auth'
      ? 'нужен вход в аккаунт'
      : status === 'pending'
        ? 'подключается…'
        : status === 'failed'
          ? 'ошибка подключения'
          : status;
