import {useEffect,useState} from 'react';
import {api,type SetupStatus} from '../api';

export const SetupReadiness: React.FC<{onReadyChange?:(ready:boolean)=>void}> = ({onReadyChange}) => {
  const [status,setStatus]=useState<SetupStatus|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const refresh=async()=>{
    setBusy(true);setError('');
    try {const next=await api.setupStatus();setStatus(next);onReadyChange?.(next.ready);}
    catch(e){setError((e as Error).message);onReadyChange?.(false);}
    finally{setBusy(false);}
  };
  useEffect(()=>{void refresh();},[]);
  return <section className="form" aria-label="Готовность студии">
    <div className="form-field"><span>Готовность студии</span><small>Проверьте компоненты и выбранные сервисы перед сборкой проекта.</small></div>
    {status?.checks.map(c=><div key={c.id} className={`check ${c.ready?'ok':c.required?'bad':'wait'}`}>
      <span className="dot"/><span>{c.name}</span><small>{c.detail}{!c.required?' · по желанию':''}</small>
    </div>)}
    {!status&&!error?<p className="form-note">Проверяю аккаунт, сборку, Docker и подключения…</p>:null}
    {status&&!status.ready?<div className="steps"><p>Завершите отмеченные шаги. Установить недостающие компоненты:</p><div className="code">moootion setup</div><p>Figma и Magnific подключаются через аккаунт выбранного агента.</p></div>:null}
    {status?.ready?<p className="form-note">Все выбранные компоненты готовы.</p>:null}
    {error?<p className="form-error" role="alert">{error}</p>:null}
    <button type="button" className="pill" disabled={busy} onClick={()=>void refresh()}>{busy?'Проверяю…':'Проверить готовность'}</button>
  </section>;
};
