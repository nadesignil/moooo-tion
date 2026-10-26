import {IconLayoutList, IconLayoutRows} from '@tabler/icons-react';
import {useStudio} from '../store';
import {ActionRows} from './ActionRows';

/**
 * The actions, always right under the sequence. One view: a layer is a compact track,
 * opened (its chevron, a click in the preview, a selected action) it lists each action.
 */
export const SchemePanel: React.FC = () => {
  const project = useStudio((s) => s.project);
  const all = useStudio((s) => s.openLayers.all);
  const setAll = useStudio((s) => s.setAllLayersOpen);
  if (!project) return null;

  return (
    <section className="scheme">
      <div className="scheme-head">
        <h2>Действия</h2>
        <div className="panel-tools">
          <button
            className="chip no-end"
            onClick={() => setAll(!all)}
            title={all ? 'Свернуть слои: действия объекта на одной дорожке' : 'Развернуть все слои: строка на каждое действие'}
          >
            {all ? <IconLayoutRows size={16} stroke={1.5} /> : <IconLayoutList size={16} stroke={1.5} />}
            {all ? 'Свернуть слои' : 'Развернуть все'}
          </button>
        </div>
      </div>
      <div className="scheme-body">
        <ActionRows />
      </div>
    </section>
  );
};
