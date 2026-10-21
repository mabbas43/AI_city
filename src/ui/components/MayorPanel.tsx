import {
  DIFFICULTY,
  MILESTONES,
  RANKS,
  TICKS_PER_HOUR,
  cityRank,
  daysUntilElection,
  electionGrant,
  formatTimestamp,
  milestoneProgress,
  reelectionThreshold,
  targetApproval,
} from '../../sim';
import { useGame } from '../useGame';
import { Badge, MiniBar, Section } from './common';
import { BulletinBody } from './Overlays';

export function MayorPanel() {
  const ctrl = useGame();
  const w = ctrl.world;
  const a = w.approval;
  const target = targetApproval(a.factors);
  const needed = reelectionThreshold(w);
  const days = daysUntilElection(w);
  const rank = cityRank(w);
  const done = MILESTONES.filter((m) => w.milestones[m.id] !== undefined).length;
  const factors = [...a.factors].filter((f) => f.label !== 'Baseline').sort((x, y) => Math.abs(y.value) - Math.abs(x.value));
  const effects = w.effects.filter((e) => e.untilTick > w.tick);
  const tone = a.value >= needed + 10 ? 'ok' : a.value >= needed ? 'warn' : 'crit';

  return (
    <div className="mayor">
      <div className="approval-card">
        <div className="approval-head">
          <div>
            <div className="muted small">Mayor approval</div>
            <div className={`approval-value text-${tone}`}>{Math.round(a.value)}%</div>
          </div>
          <div className="approval-meta">
            <span className="mono small">
              trend {target > a.value + 0.5 ? '▲' : target < a.value - 0.5 ? '▼' : '•'} {Math.round(target)}%
            </span>
            <span className="muted small">{DIFFICULTY[w.difficulty].label} difficulty</span>
          </div>
        </div>
        <div className="approval-track">
          <div className={`approval-fill tone-${tone}`} style={{ width: `${a.value}%` }} />
          <div className="approval-needed" style={{ left: `${needed}%` }} title={`${needed}% needed`} />
        </div>
        <div className="small muted">
          {w.sandbox ? (
            'Sandbox mode: no elections.'
          ) : (
            <>
              Election in <b className="text-ok">{days < 1 ? `${Math.ceil(days * 24)}h` : `${days.toFixed(1)} days`}</b> · needs {needed}% · win pays {electionGrant(w)} cr · term {w.election.term}
            </>
          )}
        </div>
      </div>

      <Section title="Why citizens approve (or not)">
        <div className="factors">
          {factors.map((f) => (
            <div key={f.label} className="factor">
              <span>{f.label}</span>
              <span className={`mono ${f.value >= 0 ? 'text-ok' : 'text-crit'}`}>
                {f.value > 0 ? '+' : ''}
                {f.value}
              </span>
            </div>
          ))}
        </div>
      </Section>

      {effects.length > 0 && (
        <Section title="Active decisions">
          {effects.map((e) => (
            <div key={e.kind} className="kv">
              <span className="kv-k">{e.label}</span>
              <span className="kv-v mono">{Math.ceil((e.untilTick - w.tick) / TICKS_PER_HOUR)}h left</span>
            </div>
          ))}
        </Section>
      )}

      <Section title={`Milestones · ${done}/${MILESTONES.length}`} aside={<Badge tone="accent">{RANKS[rank]}</Badge>}>
        <div className="ranks">
          {RANKS.map((r, i) => (
            <span key={r} className={`rank ${i <= rank ? 'rank-on' : ''}`}>
              {r}
            </span>
          ))}
        </div>
        <ul className="milestones">
          {MILESTONES.map((m) => {
            const p = milestoneProgress(w, m);
            const achieved = w.milestones[m.id] !== undefined;
            return (
              <li key={m.id} className={achieved ? 'ms-done' : ''}>
                <div className="ms-head">
                  <span className="ms-title">
                    {achieved ? '✓ ' : ''}
                    {m.title}
                  </span>
                  <span className="mono small">{achieved ? formatTimestamp(w.milestones[m.id]) : `+${m.reward} cr`}</span>
                </div>
                <div className="muted small">
                  {m.description}
                  {m.rank !== undefined && !achieved && ` Rank → ${RANKS[m.rank]}.`}
                </div>
                {!achieved && (
                  <div className="ms-progress">
                    <MiniBar value={p.value / p.target} tone="accent" />
                    <span className="mono small muted">
                      {p.value}/{p.target}
                      {m.hours ? 'h' : ''}
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="The Morning Circuit">
        {w.bulletins.length === 0 && <div className="muted small">The first edition arrives at 06:00 on day 2.</div>}
        {[...w.bulletins].reverse().map((b) => (
          <details key={b.tick} className="bulletin-archive" open={b === w.bulletins[w.bulletins.length - 1]}>
            <summary>
              <span className="mono muted">Day {b.day}</span> {b.headline}
            </summary>
            <BulletinBody b={b} />
          </details>
        ))}
      </Section>
    </div>
  );
}
