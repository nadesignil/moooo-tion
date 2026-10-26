import {IconX} from '@tabler/icons-react';

export const FilePick: React.FC<{
  icon: React.ReactNode;
  label: string;
  accept: string;
  file: File | null;
  onFile: (f: File | null) => void;
}> = ({icon, label, accept, file, onFile}) => (
  <label className={`file-pick ${file ? 'has' : ''}`}>
    <input type="file" accept={accept} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
    {icon}
    <span>
      <b>{label}</b>
      <small>{file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} МБ` : 'по желанию · выбрать файл'}</small>
    </span>
    {file ? (
      <button
        className="icon-btn"
        onClick={(e) => {
          e.preventDefault();
          onFile(null);
        }}
      >
        ×
      </button>
    ) : null}
  </label>
);

/** Several files: each pick adds to the list (references, assets). */
export const MultiPick: React.FC<{
  icon: React.ReactNode;
  label: string;
  hint: string;
  accept: string;
  files: File[];
  onFiles: (f: File[]) => void;
}> = ({icon, label, hint, accept, files, onFiles}) => (
  <div className={`file-pick refs ${files.length ? 'has' : ''}`}>
    <label className="refs-add">
      <input
        type="file"
        accept={accept || undefined}
        multiple
        onChange={(e) => {
          const picked = [...(e.target.files ?? [])];
          // the same file twice is one entry
          const known = new Set(files.map((f) => `${f.name}/${f.size}`));
          onFiles([...files, ...picked.filter((f) => !known.has(`${f.name}/${f.size}`))]);
          e.target.value = '';
        }}
      />
      {icon}
      <span>
        <b>{label}</b>
        <small>{files.length ? `${files.length} · добавить ещё` : `по желанию · ${hint}`}</small>
      </span>
    </label>
    {files.length ? (
      <div className="refs-list">
        {files.map((f, i) => (
          <span key={`${f.name}/${f.size}`} className="att-chip">
            <span>{f.name}</span>
            <small style={{opacity: 0.5}}>{(f.size / 1024 / 1024).toFixed(1)} МБ</small>
            <button onClick={() => onFiles(files.filter((_, j) => j !== i))} title="Убрать">
              <IconX size={13} />
            </button>
          </span>
        ))}
      </div>
    ) : null}
  </div>
);
