import { useState } from 'react';
import { formatTimestamp, type CityEvent, type EventSeverity } from '../../sim';
import { useGame } from '../useGame';

type Filter = 'all' | 'warning' | 'critical';

const RANK: Record<EventSeverity, number> = { info: 0, warning: 1, critical: 2 };

function EventRow({ e }: { e: CityEvent }) {
  const ctrl = useGame();
  const focus = () => {
    if (e.buildingIds.length && ctrl.world.buildings.some((b) => b.id === e.buildingIds[0])) ctrl.select({ kind: 'building', id: e.buildingIds[0] });
    else if (e.citizenIds.length && ctrl.world.citizens.some((c) => c.id === e.citizenIds[0])) ctrl.select({ kind: 'citizen', id: e.citizenIds[0] });
  };
  const linked = e.buildingIds.length + e.citizenIds.length > 0;
  return (
    <li className={`event sev-${e.severity}`}>
      <div className="event-head">
        <span className="event-time mono">{formatTimestamp(e.tick)}</span>
        <span className="event-title">{e.title}</span>
        {linked && (
          <button className="link small" onClick={focus}>
            inspect
          </button>
        )}
      </div>
      <div className="event-desc">{e.description}</div>
      {e.causes.length > 0 && (
        <ul className="event-causes">
          {e.causes.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function EventLog() {
  const ctrl = useGame();
  const [filter, setFilter] = useState<Filter>('all');
  const events = ctrl.world.events;
  const min = filter === 'all' ? 0 : RANK[filter];
  const shown = events.filter((e) => RANK[e.severity] >= min).slice(-80).reverse();
  const counts = { warning: events.filter((e) => e.severity === 'warning').length, critical: events.filter((e) => e.severity === 'critical').length };

  return (
    <section className="eventlog">
      <header className="eventlog-head">
        <h3>Event log</h3>
        <span className="muted small hide-narrow">Every event lists the conditions that caused it</span>
        <div className="seg seg-small">
          {(['all', 'warning', 'critical'] as Filter[]).map((f) => (
            <button key={f} className={`seg-btn ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? `All ${events.length}` : f === 'warning' ? `Warnings ${counts.warning}` : `Critical ${counts.critical}`}
            </button>
          ))}
        </div>
        <label className="check small">
          <input type="checkbox" checked={ctrl.pauseOnCritical} onChange={(e) => ctrl.setPauseOnCritical(e.target.checked)} />
          Pause on critical
        </label>
        <label className="check small">
          <input type="checkbox" checked={ctrl.pauseOnPetition} onChange={(e) => ctrl.setPauseOnPetition(e.target.checked)} />
          Pause on decisions
        </label>
      </header>
      <ul className="events">
        {shown.length === 0 && <li className="muted small pad">No events yet. Events appear when real conditions in the city trigger them.</li>}
        {shown.map((e) => (
          <EventRow key={e.id} e={e} />
        ))}
      </ul>
    </section>
  );
}
