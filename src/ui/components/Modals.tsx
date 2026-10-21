import { useState } from 'react';
import { DIFFICULTY, MILESTONES, TERM_DAYS, dayOf, rankName, type Difficulty } from '../../sim';
import { useGame } from '../useGame';

export function NewGameModal() {
  const ctrl = useGame();
  const [difficulty, setDifficulty] = useState<Difficulty>('standard');
  const [seed, setSeed] = useState('');
  const firstVisit = ctrl.firstVisit;
  const start = () => {
    const n = Number.parseInt(seed, 10);
    ctrl.newGame(Number.isFinite(n) ? Math.abs(n) % 1e9 : undefined, difficulty);
  };
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-kicker">AI City · The Living World</div>
        <h2>{firstVisit ? 'Welcome, Mayor' : 'Found a new city'}</h2>
        <p>
          Twenty citizens live, work, shop and make friends on their own. You can't control them, only the city they live in: roads, buildings, taxes and how you answer their
          petitions.
        </p>
        <ul className="modal-list">
          <li>
            <b>Win elections.</b> Every {TERM_DAYS} days citizens vote. Keep approval above the threshold or you are out.
          </li>
          <li>
            <b>Hit milestones.</b> Grow from Settlement to Metropolis to earn regional grants and unlock buildings.
          </li>
          <li>
            <b>Read the city.</b> Weather, weekends, pollution and commutes all affect moods. Every event shows its causes.
          </li>
        </ul>
        <div className="modal-field">
          <span className="muted small">Difficulty</span>
          <div className="difficulty">
            {(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => (
              <button key={d} className={`diff ${difficulty === d ? 'active' : ''}`} onClick={() => setDifficulty(d)}>
                <b>{DIFFICULTY[d].label}</b>
                <span className="small muted">{DIFFICULTY[d].description}</span>
              </button>
            ))}
          </div>
        </div>
        <label className="modal-field">
          <span className="muted small">Seed (optional, same seed = same city)</span>
          <input className="input mono" value={seed} placeholder="random" inputMode="numeric" onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, '').slice(0, 9))} />
        </label>
        <div className="actions">
          <button className="btn btn-accent" onClick={start}>
            Found the city
          </button>
          {!firstVisit && (
            <button className="btn btn-ghost" onClick={() => ctrl.closeModal()}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function GameOverModal() {
  const ctrl = useGame();
  const w = ctrl.world;
  const peak = Math.max(...w.history.map((h) => h.population), w.citizens.length);
  const done = MILESTONES.filter((m) => w.milestones[m.id] !== undefined).length;
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-kicker text-crit">Election result</div>
        <h2>You have been voted out</h2>
        <p>{w.gameOver?.reason}.</p>
        <div className="summary-grid">
          <div>
            <span className="muted small">Days in office</span>
            <b className="mono">{dayOf(w.tick) - 1}</b>
          </div>
          <div>
            <span className="muted small">Terms won</span>
            <b className="mono">{w.election.term - 1}</b>
          </div>
          <div>
            <span className="muted small">Peak population</span>
            <b className="mono">{peak}</b>
          </div>
          <div>
            <span className="muted small">Milestones</span>
            <b className="mono">
              {done}/{MILESTONES.length}
            </b>
          </div>
          <div>
            <span className="muted small">City rank</span>
            <b>{rankName(w)}</b>
          </div>
        </div>
        <div className="actions">
          <button className="btn btn-accent" onClick={() => ctrl.openModal('newGame')}>
            Try again
          </button>
          <button className="btn btn-ghost" onClick={() => ctrl.continueSandbox()}>
            Keep playing (sandbox)
          </button>
        </div>
      </div>
    </div>
  );
}
