import {useEffect, useState} from 'react';
import {api, type ConnectorsStatus} from '../api';
import {connectorLabel, refreshConnectors} from '../connectors';

export const CodexConnectors: React.FC = () => {
  const [status,setStatus] = useState<ConnectorsStatus|null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [links,setLinks] = useState<Record<string,string>>({});
  const refresh = async (fresh = false) => {
    setBusy(true); setError('');
    try {setStatus(await api.codexConnectors(fresh)); if (fresh) await refreshConnectors();}
    catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  };
  useEffect(()=>{void refresh();},[]);
  const connect = async (id:'figma'|'magnific') => {
    const popup = window.open('about:blank','_blank');
    if(popup) popup.opener = null;
    setError('');
    try {
      const r = await api.loginCodexConnector(id);
      setLinks((s)=>({...s,[id]:r.authUrl}));
      if(popup) popup.location.href=r.authUrl;
    } catch(e) {popup?.close();setError((e as Error).message);}
  };
  return <section className="form" aria-label="Подключения Codex">
    <div className="form-field"><span>Подключения Codex</span><small>Войдите в каждый сервис, затем нажмите «Проверить подключения». Ключи вручную не нужны.</small></div>
    {(['figma','magnific'] as const).map(id=>{
      const c=status?.connectors.find(c=>c.id===id);
      const ok=c?.status==='connected';
      return <div key={id} className="form" style={{gap:8}}>
        <div className={`check ${!c ? 'wait' : ok ? 'ok' : 'bad'}`}><span className="dot"/><span>{id==='figma'?'Figma':'Magnific'}</span><small>{!c?'проверяю…':ok?`${c.tools} инструментов`:connectorLabel(c.status).replace('в claude.ai','в аккаунт')}</small></div>
        <p className="form-note">{id==='figma'?'Чтение макетов, слоёв, переменных и скриншотов.':'Изображения, видео, звук и обработка. Платные вызовы ждут вашего разрешения в чате.'}</p>
        {!ok ? <button type="button" className="pill" style={{height:40,alignSelf:'flex-start'}} onClick={()=>connect(id)}>Подключить {id==='figma'?'Figma':'Magnific'}</button> : null}
        {links[id] ? <p className="form-note"><a href={links[id]} target="_blank" rel="noopener noreferrer">Открыть страницу входа</a> · Завершите вход и проверьте подключение.</p> : null}
      </div>;
    })}
    {error||status?.error?<p className="form-error" role="alert">{error||status?.error}</p>:null}
    <button type="button" className="pill" disabled={busy} onClick={()=>refresh(true)}>{busy?'Проверяю подключения…':'Проверить подключения'}</button>
  </section>;
};
