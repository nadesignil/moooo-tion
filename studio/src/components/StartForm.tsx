import {useEffect,useState} from 'react';
import {Logo} from './Logo';
import {AgentConnection} from './AgentConnection';
import {SetupReadiness} from './SetupReadiness';
import {CodexConnectors} from './CodexConnectors';
import {api,type AgentProvider} from '../api';

export const StartForm: React.FC<{onReady: () => void}> = ({onReady}) => {
  const [provider,setProvider]=useState<AgentProvider|null>(null);
  const [connected,setConnected]=useState(false);
  const [ready,setReady]=useState(false);
  const [revision,setRevision]=useState(0);
  const refresh=()=>{api.settings().then(s=>setProvider(s.agentProvider)).catch(()=>{});setRevision(v=>v+1);};
  useEffect(()=>{refresh();},[]);
  return <div className="start"><div className="start-card">
    <Logo />
    <div><h1>Подготовьте студию</h1><p style={{marginTop:12}}>Проверьте аккаунт и сервисы для сборки проектов.</p></div>
    <AgentConnection onReady={()=>{setConnected(true);setReady(false);refresh();}} />
    <SetupReadiness key={revision} onReadyChange={setReady}/>
    {provider==='codex'?<CodexConnectors/>:<p className="form-note">Figma и Magnific: claude.ai → Настройки → Коннекторы. После входа нажмите «Проверить готовность».</p>}
    {connected&&ready?<button className="pill solid" onClick={onReady}>Открыть студию</button>:null}
    {connected&&!ready?<button className="form-more" onClick={onReady}>Продолжить с доступными инструментами</button>:null}
  </div></div>;
};
