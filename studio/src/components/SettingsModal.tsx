import {useEffect, useState} from 'react';
import {api, type ClaudeStatus} from '../api';
import {useStudio} from '../store';
import {Checkbox} from './Checkbox';
import {Modal} from './Modal';

const AGENT_MODELS = [
  ['claude-opus-5-5', 'Opus 5.5'],
  ['claude-sonnet-5-5', 'Sonnet 5.5'],
] as const;

export const SettingsModal: React.FC = () => {
  const autoReplay = useStudio((s) => s.autoReplay);
  const setAutoReplay = useStudio((s) => s.setAutoReplay);
  const setModal = useStudio((s) => s.setModal);
  const [claude, setClaude] = useState<ClaudeStatus | null>(null);
  const [figma, setFigma] = useState<boolean | null>(null);
  const [fast, setFast] = useState(true);
  const [model, setModel] = useState('');
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState('');

  useEffect(() => {
    api.claudeStatus().then(setClaude).catch(() => undefined);
    api
      .settings()
      .then((s) => {
        setFigma(s.figmaToken);
        setFast(s.fastPath);
        setModel(s.agentModel);
      })
      .catch(() => undefined);
  }, []);

  const save = async (value: string) => {
    const s = await api.saveSettings({figmaToken: value});
    setFigma(s.figmaToken);
    setToken('');
    setSaved(value ? 'Токен сохранён на этом компьютере' : 'Токен удалён');
  };

  return (
    <Modal title="Настройки" onClose={() => setModal(null)}>
      <div className="form">
        <div className={`check ${claude?.login || claude?.apiKey ? 'ok' : 'bad'}`}>
          <span className="dot" />
          <span>Claude Code</span>
          <small>{claude ? (claude.verified ? `подключён · ${claude.verified.model}` : claude.login ? 'вход найден' : 'нет входа') : '…'}</small>
        </div>
        <div className={`check ${figma ? 'ok' : ''}`}>
          <span className="dot" />
          <span>Figma</span>
          <small>{figma ? 'токен задан' : 'через коннектор Claude (claude.ai Figma)'}</small>
        </div>
        <label className="form-field">
          <span>
            Токен Figma <em>запасной путь</em>
          </span>
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={figma ? '••••••••  (задан)' : 'figd_…'} autoComplete="off" />
          <small>
            Обычно не нужен: агент читает Figma через коннектор вашего аккаунта Claude. Токен пригодится, если коннектор
            отключён. Создаётся в Figma → Settings → Security → Personal access tokens. Хранится только на этом компьютере.
          </small>
        </label>
        <div style={{display: 'flex', gap: 8}}>
          <button className="pill solid" style={{height: 44}} disabled={!token.trim()} onClick={() => save(token)}>
            Сохранить токен
          </button>
          {figma ? (
            <button className="pill" style={{height: 44}} onClick={() => save('')}>
              Удалить
            </button>
          ) : null}
        </div>
        {saved ? <p className="form-note">{saved}</p> : null}
        <div className="form-field">
          <span>Модель агента</span>
          <div className="seg" style={{alignSelf: 'flex-start'}}>
            {AGENT_MODELS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={model === id ? 'on' : ''}
                onClick={async () => {
                  const st = await api.saveSettings({agentModel: id});
                  setModel(st.agentModel);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <small>
            Opus дольше думает и точнее переносит раскадровку; Sonnet быстрее и тратит лимит подписки заметно медленнее.
            Действует со следующего запуска агента.
          </small>
        </div>
        <Checkbox
          checked={fast}
          onChange={async (v) => {
            const st = await api.saveSettings({fastPath: v});
            setFast(st.fastPath);
          }}
          title="Быстрые правки на Sonnet"
          hint="Правки времени, кривых и параметров сначала делает быстрая модель — за секунды и в разы дешевле. Она меняет только project.json; если нужна правка кода, задача сама переходит к основной модели."
        />
        <Checkbox
          checked={autoReplay}
          onChange={setAutoReplay}
          title="Проигрывать изменённое действие в превью"
          hint="После каждой правки времени или кривой большое превью проигрывает этот участок с начала."
        />
      </div>
    </Modal>
  );
};
