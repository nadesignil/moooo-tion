import {useEffect, useState} from 'react';
import {api, type ClaudeStatus} from '../api';
import {Logo} from './Logo';

type Check = 'idle' | 'wait' | 'ok' | 'bad';

/** Isolated start screen: connect the Claude client that lives on this device. */
export const StartForm: React.FC<{onReady: () => void}> = ({onReady}) => {
  const [status, setStatus] = useState<ClaudeStatus | null>(null);
  const [check, setCheck] = useState<Check>('idle');
  const [detail, setDetail] = useState('');

  const refresh = () => api.claudeStatus().then(setStatus).catch(() => setStatus(null));
  // the API server may still be starting: poll until it answers
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const st = await api.claudeStatus().catch(() => null);
      if (stop) return;
      if (st) setStatus(st);
      else setTimeout(tick, 1000);
    };
    tick();
    return () => {
      stop = true;
    };
  }, []);

  const verify = async () => {
    setCheck('wait');
    setDetail('');
    const res = await api.verifyClaude().catch((e: Error) => ({ok: false, error: e.message, model: ''}));
    if (res.ok) {
      setCheck('ok');
      setDetail(res.model ?? '');
      localStorage.setItem('moootion:claude', JSON.stringify({at: Date.now(), model: res.model}));
      setTimeout(onReady, 700);
    } else {
      setCheck('bad');
      setDetail(res.error ?? 'нет ответа');
      refresh();
    }
  };

  const hasClient = Boolean(status?.login || status?.apiKey);

  // while there is no login, keep watching: the form turns green by itself after /login
  useEffect(() => {
    if (!status || hasClient) return;
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [status, hasClient]);
  const loginLabel = !status ? 'проверяю…' : status.login ? 'найден' : status.apiKey ? 'API-ключ' : 'не найден';

  return (
    <div className="start">
      <div className="start-card">
        <Logo />
        <div>
          <h1>Подключите Claude</h1>
          <p style={{marginTop: 12}}>
            Студия — оболочка: анимирует агент, а вы правите параметры. Агент работает через Claude Code на этом
            компьютере. Вход хранится локально, поэтому подключение постоянное.
          </p>
        </div>

        <div className={`check ${status ? (hasClient ? 'ok' : 'bad') : 'wait'}`}>
          <span className="dot" />
          <span>Вход в аккаунт Claude Code</span>
          <small>{loginLabel}</small>
        </div>
        <div className={`check ${check === 'idle' ? '' : check}`}>
          <span className="dot" />
          <span>Связь с агентом</span>
          <small>
            {check === 'idle' && 'не проверена'}
            {check === 'wait' && 'отправляю тестовый запрос…'}
            {check === 'ok' && `готов · ${detail}`}
            {check === 'bad' && detail}
          </small>
        </div>

        {status && !hasClient ? (
          <div className="steps">
            <p>Один раз войдите в Claude Code в обычном терминале — дальше студия будет подключаться сама:</p>
            <ol>
              {!status.cli ? (
                <li>
                  Установите Claude Code
                  <div className="code">npm i -g @anthropic-ai/claude-code</div>
                </li>
              ) : null}
              <li>
                Войдите в аккаунт Claude
                <div className="code">claude auth login</div>
              </li>
              <li>Подтвердите вход в браузере. Если браузер покажет код — скопируйте его и вставьте в терминал.</li>
              <li>Форма сама станет зелёной — нажмите «Проверить и войти».</li>
            </ol>
          </div>
        ) : null}

        <div style={{display: 'flex', gap: 8}}>
          <button className="pill solid" style={{flex: 1}} onClick={verify} disabled={!hasClient || check === 'wait'}>
            {check === 'wait' ? 'Проверяю…' : 'Проверить и войти'}
          </button>
          <button className="pill" onClick={refresh}>
            Обновить
          </button>
        </div>
      </div>
    </div>
  );
};
