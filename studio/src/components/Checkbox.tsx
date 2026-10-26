import {IconCheck} from '@tabler/icons-react';

/**
 * The studio's one checkbox: a rounded box that turns lime with a dark tick when on.
 * With `title` it becomes a whole clickable row (title + optional hint); without, just the box.
 */
export const Checkbox: React.FC<{
  checked: boolean;
  onChange: (v: boolean) => void;
  title?: string;
  hint?: string;
  disabled?: boolean;
}> = ({checked, onChange, title, hint, disabled}) => {
  const box = (
    <span className={`cbx ${checked ? 'on' : ''}`} aria-hidden>
      {checked ? <IconCheck size={13} stroke={3} /> : null}
    </span>
  );
  const input = (
    <input type="checkbox" className="cbx-input" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
  );
  if (!title) {
    return (
      <label className={`cbx-wrap ${disabled ? 'disabled' : ''}`}>
        {input}
        {box}
      </label>
    );
  }
  return (
    <label className={`cbx-row ${checked ? 'on' : ''} ${disabled ? 'disabled' : ''}`}>
      {input}
      {box}
      <span className="cbx-text">
        <b>{title}</b>
        {hint ? <small>{hint}</small> : null}
      </span>
    </label>
  );
};
