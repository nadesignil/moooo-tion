import {useState} from 'react';
import {IconPlus, IconX} from '@tabler/icons-react';
import {BAN_SUGGESTIONS, STYLE_PRESETS, stylePreset} from '../../../runtime/styles';

export type StyleValue = {style: string; styleNote?: string; bans: string[]};

/**
 * Style preset + editable ban list. Picking a preset replaces the bans with its
 * starting set; after that the list is the user's: remove chips, add suggestions or own words.
 * Shared by «Настройки проекта» and the new-project form.
 */
/** part: 'style' — the preset only, 'bans' — the ban list, 'all' — preset, own words and bans */
export const StyleFields: React.FC<{value: StyleValue; onChange: (v: StyleValue) => void; part?: 'all' | 'style' | 'bans'}> = ({
  value,
  onChange,
  part = 'all',
}) => {
  const [draft, setDraft] = useState('');
  const preset = stylePreset(value.style);
  const add = (ban: string) => {
    const b = ban.trim();
    if (b && !value.bans.includes(b)) onChange({...value, bans: [...value.bans, b]});
  };
  const suggestions = BAN_SUGGESTIONS.filter((b) => !value.bans.includes(b));

  const showStyle = part !== 'bans';
  const showBans = part !== 'style';

  return (
    <>
      {showStyle ? (
        <>
      <div className="form-field">
        <span>Стиль</span>
        <div className="chip-row">
          {STYLE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`chip no-end ${value.style === p.id ? 'active' : ''}`}
              onClick={() => onChange({...value, style: p.id, bans: p.id === 'custom' ? value.bans : [...p.bans]})}
            >
              {p.title}
            </button>
          ))}
        </div>
        {preset?.note ? <small>{preset.note}</small> : null}
      </div>
      {part === 'all' ? (
      <label className="form-field">
        <span>
          Стиль своими словами <em>по желанию</em>
        </span>
        <textarea
          rows={2}
          value={value.styleNote ?? ''}
          onChange={(e) => onChange({...value, styleNote: e.target.value})}
          placeholder="Например: тёплые тени, плавные наезды, интерфейс собирается из одной карточки"
        />
      </label>
      ) : null}
        </>
      ) : null}
      {showBans ? (
      <div className="form-field">
        <span>
          Запрещённые приёмы <em>агент их не использует</em>
        </span>
        <div className="chip-row">
          {value.bans.length ? null : <small>Запретов нет — агент выбирает приёмы сам.</small>}
          {value.bans.map((b) => (
            <span key={b} className="ban-chip">
              {b}
              <button type="button" onClick={() => onChange({...value, bans: value.bans.filter((x) => x !== b)})} title="Снять запрет">
                <IconX size={12} />
              </button>
            </span>
          ))}
        </div>
        <div className="ban-add">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Свой запрет: «тени под карточками»…"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                add(draft);
                setDraft('');
              }
            }}
          />
          <button
            type="button"
            className="chip icon"
            disabled={!draft.trim()}
            onClick={() => {
              add(draft);
              setDraft('');
            }}
            title="Добавить запрет"
          >
            <IconPlus size={16} />
          </button>
        </div>
        {suggestions.length ? (
          <div className="chip-row suggest">
            {suggestions.map((b) => (
              <button key={b} type="button" className="ban-suggest" onClick={() => add(b)}>
                + {b}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      ) : null}
    </>
  );
};
