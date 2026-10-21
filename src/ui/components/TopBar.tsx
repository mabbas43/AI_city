import { SPEEDS, WEATHER, cityStats, dayOf, daysUntilElection, formatClock, hoursUntilChange, rankName, reelectionThreshold, weekdayName, isWeekend } from '../../sim';
import { useGame } from '../useGame';
import { money, percent, signed } from '../format';

function Indicator({ label, value, sub, tone, fill }: { label: string; value: string; sub?: string; tone?: string; fill?: number }) {
  return (
    <div className={`indicator ${tone ? `ind-${tone}` : ''}`}>
      <span className="ind-label">{label}</span>
      <span className="ind-value mono">{value}</span>
      {sub && <span className="ind-sub">{sub}</span>}
      {fill !== undefined && (
        <div className="ind-track">
          <div className="ind-fill" style={{ width: `${Math.min(1, Math.max(0, fill)) * 100}%` }} />
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const ctrl = useGame();
  const w = ctrl.world;
  const s = cityStats(w);
  const net = Object.values(w.ledger.yesterday).reduce((a, b) => a + b, 0);
  const today = Object.values(w.ledger.today).reduce((a, b) => a + b, 0);
  const shortage = w.power.shortage;
  const hasSave = ctrl.hasSave();

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" />
        <div>
          <div className="brand-title">AI CITY</div>
          <div className="brand-sub">The Living World</div>
        </div>
      </div>

      <div className="indicators">
        <Indicator
          label="Approval"
          value={`${Math.round(w.approval.value)}%`}
          sub={w.sandbox ? 'sandbox · no elections' : `vote in ${daysUntilElection(w) < 1 ? `${Math.ceil(daysUntilElection(w) * 24)}h` : `${daysUntilElection(w).toFixed(1)}d`} · need ${reelectionThreshold(w)}%`}
          tone={w.approval.value < reelectionThreshold(w) ? 'crit' : w.approval.value < reelectionThreshold(w) + 10 ? 'warn' : 'ok'}
          fill={w.approval.value / 100}
        />
        <Indicator label="Population" value={`${s.population}`} sub={`${rankName(w)} · ${s.housingCapacity} homes${s.homeless ? ` · ${s.homeless} homeless` : ''}`} tone={s.homeless > 0 ? 'warn' : undefined} />
        <Indicator label="Treasury" value={money(w.treasury)} sub={`today ${signed(today)} · yday ${signed(net)}`} tone={w.treasury < 500 ? 'crit' : undefined} />
        <Indicator
          label="Employment"
          value={percent(s.population ? s.employed / s.population : 0)}
          sub={`${s.unemployed} jobless · ${s.openJobs} open`}
          tone={s.unemploymentRate >= 0.2 ? 'warn' : undefined}
          fill={s.population ? s.employed / s.population : 0}
        />
        <Indicator
          label="Happiness"
          value={`${Math.round(s.avgHappiness)}`}
          sub={`health ${Math.round(s.avgHealth)}`}
          tone={s.avgHappiness < 35 ? 'crit' : s.avgHappiness < 50 ? 'warn' : 'ok'}
          fill={s.avgHappiness / 100}
        />
        <Indicator
          label="Energy"
          value={`${w.power.demand} / ${w.power.supply}`}
          sub={shortage ? `SHORTAGE · ${w.power.unpoweredIds.length} dark` : `${Math.round(w.power.supply - w.power.demand)} spare`}
          tone={shortage ? 'crit' : w.power.demand > w.power.supply * 0.85 ? 'warn' : undefined}
          fill={w.power.supply ? w.power.demand / w.power.supply : 1}
        />
      </div>

      <div className="time-controls">
        <div className="weather" title={`${WEATHER[w.weather.forecast].label} expected in about ${hoursUntilChange(w)}h`}>
          <span className={`wx-icon wx-${w.weather.kind}`} />
          <div>
            <div className="small">{WEATHER[w.weather.kind].label}</div>
            <div className="muted small">
              then {WEATHER[w.weather.forecast].label.toLowerCase()} · {hoursUntilChange(w)}h
            </div>
          </div>
        </div>
        <div className="clock">
          <span className={`clock-day ${isWeekend(w.tick) ? 'text-ok' : ''}`}>
            {weekdayName(w.tick).slice(0, 3)} · Day {dayOf(w.tick)}
          </span>
          <span className="clock-time mono">{formatClock(w.tick)}</span>
        </div>
        <button className={`btn btn-icon ${ctrl.clock.paused ? 'btn-accent' : ''}`} onClick={() => ctrl.togglePause()} title="Pause / resume (Space)">
          {ctrl.clock.paused ? '▶' : '❚❚'}
        </button>
        <div className="seg">
          {SPEEDS.map((sp, i) => (
            <button key={sp} className={`seg-btn ${!ctrl.clock.paused && ctrl.clock.speed === sp ? 'active' : ''}`} onClick={() => ctrl.setSpeed(sp)} title={`Speed ${sp}x (${i + 1})`}>
              {sp}x
            </button>
          ))}
        </div>
        <div className="file-controls">
          <button className="btn" onClick={() => ctrl.save()}>Save</button>
          <button className="btn" onClick={() => ctrl.load()} disabled={!hasSave} title={hasSave ? 'Load the saved city' : 'No save yet'}>
            Load
          </button>
          <button className="btn btn-ghost" onClick={() => ctrl.openModal('newGame')}>New</button>
        </div>
      </div>
    </header>
  );
}
