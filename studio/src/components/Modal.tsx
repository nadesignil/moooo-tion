import {useEffect} from 'react';
import {IconX} from '@tabler/icons-react';

export const Modal: React.FC<{title: string; subtitle?: string; width?: number; onClose: () => void; children: React.ReactNode}> = ({
  title,
  subtitle,
  width = 560,
  onClose,
  children,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{width}} onKeyDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button className="icon-btn" onClick={onClose} title="Закрыть (Esc)">
            <IconX size={18} stroke={1.5} />
          </button>
        </div>
        <div className="modal-body scroll-y">{children}</div>
      </div>
    </div>
  );
};
