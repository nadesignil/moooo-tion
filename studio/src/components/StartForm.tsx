import {Logo} from './Logo';
import {AgentConnection} from './AgentConnection';

export const StartForm: React.FC<{onReady: () => void}> = ({onReady}) => (
  <div className="start"><div className="start-card">
    <Logo />
    <div><h1>Подключите агента</h1><p style={{marginTop: 12}}>Выберите Claude или Codex. Агент собирает и анимирует ролик, а вы управляете результатом в студии.</p></div>
    <AgentConnection onReady={onReady} />
  </div></div>
);
