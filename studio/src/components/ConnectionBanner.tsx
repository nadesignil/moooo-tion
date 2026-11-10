import {useEffect, useState} from 'react';
import {useStudio} from '../store';

export function ConnectionBanner() {
  const transport = useStudio(s => s.transportError);
  const notice = useStudio(s => s.connectionNotice);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!transport && (!notice || (notice.state === 'connected' && now - notice.at > 8000))) return null;
  const waiting = !transport && notice?.state === 'waiting';
  const recovered = !transport && notice?.state === 'connected';
  const title = transport ? 'Связь со студией недоступна'
    : waiting ? `Ожидание ${notice!.service}`
    : recovered ? 'Ответ получен'
    : notice?.state === 'retrying' ? 'Восстановление связи с Codex'
    : `${notice?.service}: ошибка запроса`;
  return <div className={`connection-banner ${waiting || recovered ? 'neutral' : ''}`} role={waiting || recovered ? 'status' : 'alert'}>
    <div><strong>{title}</strong><p>{transport ?? notice?.message}</p>
      {waiting ? <small>Ожидание: {Math.max(0, Math.floor((now - notice!.at) / 1000))} с</small> : null}</div>
    <button className="chip no-end small" onClick={() => useStudio.getState().setPanelTab('chat')}>Открыть чат</button>
  </div>;
}
