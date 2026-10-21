// Cards floating over the map: pending petitions and the morning paper.

import { TICKS_PER_HOUR, type Bulletin } from '../../sim';
import { useGame } from '../useGame';
import { signed } from '../format';

export function BulletinBody({ b }: { b: Bulletin }) {
  const ctrl = useGame();
  return (
    <div className="bulletin-body">
      <div className="bulletin-figures">
        {b.figures.map((f) => (
          <div key={f.label} className="bf">
            <span className="muted small">{f.label}</span>
            <span className="mono">{f.value}</span>
            {f.delta !== undefined && f.delta !== 0 && <span className={`mono small ${f.delta > 0 ? 'text-ok' : 'text-crit'}`}>{signed(f.delta)}</span>}
          </div>
        ))}
      </div>
      {b.stories.length > 0 && (
        <ul className="bulletin-stories">
          {b.stories.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
      {b.spotlight && (
        <div className="bulletin-spotlight">
          <span className="muted small">Citizen spotlight · </span>
          <button className="link" onClick={() => ctrl.select({ kind: 'citizen', id: b.spotlight!.citizenId })}>
            {b.spotlight.name}
          </button>
          <span className="small">, {b.spotlight.text}</span>
        </div>
      )}
      <div className="muted small">{b.weather}</div>
    </div>
  );
}

export function BulletinCard() {
  const ctrl = useGame();
  const b = ctrl.world.bulletins[ctrl.world.bulletins.length - 1];
  if (!b || b.tick <= ctrl.bulletinSeen || ctrl.modal !== 'none') return null;
  return (
    <div className="bulletin-card">
      <div className="bulletin-mast">
        <span>The Morning Circuit</span>
        <span className="mono small">Day {b.day}</span>
      </div>
      <h2 className="bulletin-headline">{b.headline}</h2>
      <BulletinBody b={b} />
      <div className="actions">
        <button className="btn btn-accent" onClick={() => ctrl.dismissBulletin()}>
          Got it
        </button>
      </div>
    </div>
  );
}

export function PetitionCards() {
  const ctrl = useGame();
  const w = ctrl.world;
  if (w.petitions.length === 0 || ctrl.modal !== 'none') return null;
  return (
    <div className="petitions">
      {w.petitions.map((p) => {
        const left = Math.max(0, Math.ceil((p.expiresAt - w.tick) / TICKS_PER_HOUR));
        const def = p.options.find((o) => o.id === p.defaultOption);
        return (
          <div key={p.id} className="petition">
            <div className="petition-head">
              <span className="petition-tag">Decision</span>
              <span className="mono small muted">{left}h left</span>
            </div>
            <h3>{p.title}</h3>
            <p className="small">{p.description}</p>
            <ul className="event-causes">
              {p.causes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="petition-options">
              {p.options.map((o) => (
                <button
                  key={o.id}
                  className={`petition-option ${o.cost > 0 ? 'costly' : ''}`}
                  disabled={o.cost > w.treasury}
                  title={o.cost > w.treasury ? `Needs ${o.cost} cr` : undefined}
                  onClick={() => ctrl.answerPetition(p.id, o.id)}
                >
                  <span className="po-label">{o.label}</span>
                  <span className="po-detail">{o.detail}</span>
                </button>
              ))}
            </div>
            {def && <div className="muted small">If you don't answer: {def.label.toLowerCase()}.</div>}
            {p.buildingId !== null && (
              <button className="link small" onClick={() => ctrl.select({ kind: 'building', id: p.buildingId! })}>
                Show on map
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
