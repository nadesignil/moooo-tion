import {useEffect, useRef, useState} from 'react';
import {api, type ClaudeStatus, type CodexStatus, type AgentProvider} from '../api';

/** Shared by onboarding and settings: selection becomes active only after verification. */
export const AgentConnection: React.FC<{onReady: () => void}> = ({onReady}) => {
  const [provider, setProvider] = useState<AgentProvider | null>(null);
  const [status, setStatus] = useState<ClaudeStatus | CodexStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState('');
  const [authUrl, setAuthUrl] = useState('');
  const picked = useRef(false);
  const current = useRef(provider);
  current.current = provider;
  useEffect(() => {api.settings().then((s) => (!picked.current && setProvider(s.agentProvider))).catch(() => setDetail('Не удалось загрузить настройки агента. Перезагрузите страницу.'));}, []);
  useEffect(() => {
    if (!provider) return;
    let live = true;
    setStatus(null); setDetail(''); setAuthUrl('');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const s = await (provider === 'codex' ? api.codexStatus() : api.claudeStatus());
        if (!live) return;
        setStatus(s);
        setDetail((d) => d.startsWith('Нет связи со студией.') ? '' : d);
        if (s.login || s.apiKey) return;
      } catch {if (live) setDetail('Нет связи со студией. Повторяем подключение…');}
      if (live) timer = setTimeout(tick, 3000);
    };
    void tick();
    return () => {live = false; clearTimeout(timer);};
  }, [provider]);
  const verify = async () => {
    if (!provider) return;
    setBusy(true); setDetail('');
    try {
      const r = await api.verifyAgent(provider);
      if (!r.ok) {setDetail(r.error ?? 'Не удалось подключиться'); return;}
      localStorage.setItem(`moootion:${provider}`, JSON.stringify({at: Date.now(), model: r.model}));
      onReady();
    } catch (e) {setDetail((e as Error).message);} finally {setBusy(false);}
  };
  const login = async () => {
    // Open in the click handler so browsers do not block the official sign-in window.
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    setBusy(true); setDetail('');
    try {
      const r = await api.codexLogin();
      if (current.current !== 'codex') {popup?.close(); return;}
      setAuthUrl(r.authUrl);
      if (popup) popup.location.href = r.authUrl;
    } catch (e) {popup?.close(); setDetail((e as Error).message);} finally {setBusy(false);}
  };
  const hasLogin = Boolean(status?.login || status?.apiKey);
  if (!provider) return <p className="form-note">{detail || 'Определяю настройки агента…'}</p>;
  return <div className="form">
    <div className="seg" style={{alignSelf: 'flex-start'}} aria-label="Агент студии">
      {(['claude', 'codex'] as const).map((p) => <button key={p} type="button" disabled={busy} className={provider === p ? 'on' : ''} onClick={() => {picked.current = true; setProvider(p);}}>{p === 'codex' ? 'Codex' : 'Claude'}</button>)}
    </div>
    <p className="form-note">{provider === 'codex' ? 'Подключите Codex через аккаунт ChatGPT. Если вы уже вошли в Codex на этом компьютере, студия использует этот вход.' : 'Агент работает через Claude Code на этом компьютере. Вход хранится локально.'}</p>
    <div className={`check ${!status ? 'wait' : hasLogin ? 'ok' : 'bad'}`}>
      <span className="dot" /><span>{provider === 'codex' ? 'Codex / ChatGPT' : 'Claude Code'}</span>
      <small>{!status ? 'проверяю…' : hasLogin ? 'вход найден' : 'loginPending' in status && status.loginPending ? 'ожидаем вход в браузере' : 'вход не найден'}</small>
    </div>
    {provider === 'codex' && status && !status.cli ? <div className="steps"><p>Установите Codex CLI и перезапустите студию:</p><div className="code">npm install -g @openai/codex</div></div> : null}
    {provider === 'codex' && status?.cli && !hasLogin ? <>
      <button className="pill" onClick={login} disabled={busy}>{busy ? 'Открываю вход…' : authUrl ? 'Открыть вход ещё раз' : 'Войти в Codex через ChatGPT'}</button>
      {authUrl ? <p className="form-note">Завершите вход в открывшемся окне. <a href={authUrl} target="_blank" rel="noopener noreferrer">Открыть страницу входа</a></p> : null}
      {'loginPending' in status && status.loginPending ? <button className="form-more" onClick={async () => {try {await api.cancelCodexLogin(); setAuthUrl('');} catch (e) {setDetail((e as Error).message);}}}>Отменить вход</button> : null}
    </> : null}
    {provider === 'claude' && status && !hasLogin ? <div className="steps"><p>Один раз войдите в Claude Code в терминале:</p>{!status.cli ? <div className="code">npm i -g @anthropic-ai/claude-code</div> : null}<div className="code">claude auth login</div><p>Подтвердите вход в браузере и вернитесь в студию.</p></div> : null}
    {provider === 'codex' ? <p className="form-note">Codex работает с кодом и ассетами проекта. Figma и Magnific подключаются отдельно в настройках студии. Платные операции Magnific требуют подтверждения в чате.</p> : null}
    {detail || (status && 'error' in status && status.error) ? <div className="form-error" role="alert">{detail || (status && 'error' in status ? status.error : '')}</div> : null}
    <button className="pill solid" onClick={verify} disabled={!hasLogin || busy}>{busy ? 'Проверяю…' : `Подключить ${provider === 'codex' ? 'Codex' : 'Claude'} и войти`}</button>
  </div>;
};
