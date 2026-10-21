import { useState } from 'react';
import { ACTION_LABELS, type Citizen } from '../../sim';
import { ACTION_COLORS, hex } from '../../game/palette';
import { useGame } from '../useGame';
import { MiniBar } from './common';

type Sort = 'name' | 'happiness' | 'money';

const SORTS: Record<Sort, (a: Citizen, b: Citizen) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  happiness: (a, b) => a.needs.happiness - b.needs.happiness,
  money: (a, b) => b.money - a.money,
};

export function CitizensList() {
  const ctrl = useGame();
  const [sort, setSort] = useState<Sort>('name');
  const sel = ctrl.selection;
  const list = [...ctrl.world.citizens].sort(SORTS[sort]);
  return (
    <div className="citizens">
      <div className="list-tools">
        <span className="muted small">{list.length} citizens · sort by</span>
        <div className="seg seg-small">
          {(Object.keys(SORTS) as Sort[]).map((s) => (
            <button key={s} className={`seg-btn ${sort === s ? 'active' : ''}`} onClick={() => setSort(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <ul className="citizen-rows">
        {list.map((c) => {
          const action = c.activity.kind === 'idle' ? 'idle' : c.activity.action;
          const label = c.activity.kind === 'idle' ? 'Idle' : `${c.activity.kind === 'traveling' ? '→ ' : ''}${ACTION_LABELS[c.activity.action]}`;
          const h = c.needs.happiness;
          return (
            <li key={c.id}>
              <button className={`citizen-row ${sel?.kind === 'citizen' && sel.id === c.id ? 'active' : ''}`} onClick={() => ctrl.select({ kind: 'citizen', id: c.id })}>
                <span className="dot" style={{ background: hex(ACTION_COLORS[action]) }} />
                <span className="cr-name">
                  {c.name}
                  <span className="muted small block">{c.occupation}</span>
                </span>
                <span className="cr-act small">{label}</span>
                <span className="cr-happy">
                  <MiniBar value={h / 100} tone={h >= 60 ? 'ok' : h >= 30 ? 'warn' : 'crit'} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
