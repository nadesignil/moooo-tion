import {useEffect, useRef, useState} from 'react';
import {IconFile, IconFolderPlus, IconMessageCircle, IconMusic, IconPlus, IconTrash} from '@tabler/icons-react';
import {api, type Asset, type Attachment} from '../api';
import {useStudio} from '../store';
import {ASSET_ROLES} from '../../../runtime/styles';

/** an asset dragged from the bin onto the chat */
export const ASSET_MIME = 'application/x-moootion-asset';
export const assetAttachment = (a: Asset): Attachment => ({name: a.file, path: a.path, url: a.url, type: a.type, size: a.size});

const sourceLabel = (a: Asset) =>
  a.source === 'magnific' ? 'Magnific' : a.source === 'agent' ? 'агент' : a.source === 'folder' ? 'в папке' : 'импорт';

/**
 * The asset bin: what the user collected for the video (and what the agent generated),
 * each file with a role and tags. The agent gets this table with every run.
 */
export const Assets: React.FC = () => {
  const project = useStudio((s) => s.project);
  // the agent may add files (Magnific): refetch after each run
  const chatVersion = useStudio((s) => s.chatVersion);
  const attachExisting = useStudio((s) => s.attachExisting);
  const [list, setList] = useState<Asset[] | null>(null);
  const [busy, setBusy] = useState(0);
  const [over, setOver] = useState(false);
  const [error, setError] = useState('');
  const [role, setRole] = useState<string>('all');
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const projectId = project?.id;

  useEffect(() => {
    if (!projectId) return;
    api.assets(projectId).then(setList).catch((e: Error) => setError(e.message));
  }, [projectId, chatVersion]);

  // the folder picker needs the non-standard attribute
  useEffect(() => {
    folderRef.current?.setAttribute('webkitdirectory', '');
  }, []);

  if (!project) return null;

  const add = async (files: File[]) => {
    const ok = files.filter((f) => f.size > 0 && !f.name.startsWith('.'));
    if (!ok.length) return;
    setError('');
    setBusy(ok.length);
    try {
      setList(await api.addAssets(project.id, ok));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(0);
    }
  };
  const patch = async (a: Asset, p: {role?: string; tags?: string[]}) => {
    setList((cur) => cur?.map((x) => (x.file === a.file ? {...x, ...p} : x)) ?? cur);
    await api.updateAsset(project.id, a.file, p).then(setList).catch((e: Error) => setError(e.message));
  };
  const remove = async (a: Asset) => {
    if (!confirm(`Удалить «${a.file}» из корзины? Файл удалится из inputs/assets/.`)) return;
    await api.removeAsset(project.id, a.file).then(setList).catch((e: Error) => setError(e.message));
  };

  const roles = [...new Set((list ?? []).map((a) => a.role))];
  const shown = (list ?? []).filter((a) => role === 'all' || a.role === role);
  const spent = (list ?? []).reduce((n, a) => n + (a.cost ?? 0), 0);

  return (
    <div
      className={`assets ${over ? 'over' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        add([...e.dataTransfer.files]);
      }}
    >
      <div className="assets-bar">
        <button className={`chip no-end ${role === 'all' ? 'active' : ''}`} onClick={() => setRole('all')}>
          Все · {list?.length ?? 0}
        </button>
        {roles.map((r) => (
          <button key={r} className={`chip no-end ${role === r ? 'active' : ''}`} onClick={() => setRole(r)}>
            {ASSET_ROLES[r] ?? r}
          </button>
        ))}
        <span className="spacer" />
        {spent ? <span className="assets-spent">Magnific: {spent} кр.</span> : null}
        <button className="pill" style={{height: 40}} onClick={() => folderRef.current?.click()} disabled={busy > 0}>
          <IconFolderPlus size={16} stroke={1.5} /> Папка
        </button>
        <button className="pill solid" style={{height: 40}} onClick={() => fileRef.current?.click()} disabled={busy > 0}>
          <IconPlus size={16} stroke={1.5} /> {busy ? `Загружаю ${busy}…` : 'Добавить файлы'}
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            add([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <input
          ref={folderRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            add([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </div>
      {error ? <div className="form-error" style={{margin: '0 26px 10px'}}>{error}</div> : null}
      <div className="assets-grid scroll-y">
        {list && !list.length ? (
          <div className="empty">
            Корзина пуста. Перетащите сюда картинки, видео, звук и шрифты для ролика — или выберите файлы и папки кнопками выше.
            Роль подскажет агенту, для чего файл (главный объект, экран, фон, музыка…). Результаты Magnific агент кладёт сюда же.
          </div>
        ) : null}
        {shown.map((a) => (
          <AssetCard
            key={a.file}
            a={a}
            onRole={(r) => patch(a, {role: r})}
            onTags={(tags) => patch(a, {tags})}
            onRemove={() => remove(a)}
            onChat={() => attachExisting([assetAttachment(a)])}
          />
        ))}
      </div>
    </div>
  );
};

const AssetCard: React.FC<{
  a: Asset;
  onRole: (r: string) => void;
  onTags: (t: string[]) => void;
  onRemove: () => void;
  onChat: () => void;
}> = ({a, onRole, onTags, onRemove, onChat}) => {
  const [tags, setTags] = useState(a.tags.join(', '));
  useEffect(() => setTags(a.tags.join(', ')), [a.tags]);
  const commitTags = () => {
    const next = tags.split(',').map((t) => t.trim()).filter(Boolean);
    if (next.join(',') !== a.tags.join(',')) onTags(next);
  };
  return (
    <div
      className={`asset ${a.missing ? 'missing' : ''}`}
      draggable={!a.missing}
      onDragStart={(e) => {
        e.dataTransfer.setData(ASSET_MIME, JSON.stringify(assetAttachment(a)));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      title={a.prompt ? `Промпт: ${a.prompt}` : 'Перетащите на вкладку «Чат», чтобы приложить к сообщению'}
    >
      <div className="asset-thumb">
        {a.missing ? (
          <span className="asset-kind">файла нет</span>
        ) : a.type.startsWith('image/') ? (
          <img src={a.url} alt="" loading="lazy" draggable={false} />
        ) : a.type.startsWith('video/') ? (
          <video src={a.url} muted preload="metadata" onMouseEnter={(e) => e.currentTarget.play()} onMouseLeave={(e) => e.currentTarget.pause()} />
        ) : a.type.startsWith('audio/') ? (
          <span className="asset-kind">
            <IconMusic size={28} stroke={1.2} />
          </span>
        ) : (
          <span className="asset-kind">
            <IconFile size={28} stroke={1.2} />
            {a.file.split('.').pop()}
          </span>
        )}
        <span className={`asset-source ${a.source}`}>
          {sourceLabel(a)}
          {a.cost ? ` · ${a.cost} кр.` : ''}
        </span>
      </div>
      <div className="asset-name" title={a.file}>
        {a.file}
      </div>
      {a.type.startsWith('audio/') && !a.missing ? <audio src={a.url} controls preload="none" /> : null}
      <select value={a.role} onChange={(e) => onRole(e.target.value)}>
        {Object.entries(ASSET_ROLES).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      <input
        className="asset-tags"
        value={tags}
        placeholder="теги через запятую"
        onChange={(e) => setTags(e.target.value)}
        onBlur={commitTags}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <div className="asset-actions">
        <button className="msg-btn" onClick={onChat} disabled={a.missing} title="Приложить к сообщению агенту">
          <IconMessageCircle size={14} /> в чат
        </button>
        <span className="spacer" />
        <button className="msg-btn" onClick={onRemove} title="Удалить из корзины">
          <IconTrash size={14} />
        </button>
      </div>
    </div>
  );
};
