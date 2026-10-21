import { BUILDING_DEFS, cityStats, type StatsSample } from '../../sim';
import { useGame } from '../useGame';
import { money, percent, signed } from '../format';
import { KV, Section } from './common';

interface Series {
  values: number[];
  color: string;
  label: string;
}

function Sparkline({ series, height = 54, min }: { series: Series[]; height?: number; min?: number }) {
  const width = 320;
  const all = series.flatMap((s) => s.values);
  if (all.length < 2) return <div className="muted small">Collecting data…</div>;
  const lo = min ?? Math.min(...all);
  const hi = Math.max(...all, lo + 1);
  const n = Math.max(...series.map((s) => s.values.length));
  const pts = (vals: number[]) => vals.map((v, i) => `${(i / Math.max(1, n - 1)) * width},${height - ((v - lo) / (hi - lo)) * (height - 4) - 2}`).join(' ');
  return (
    <div className="spark">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" width="100%" height={height}>
        <line x1="0" x2={width} y1={height - 1} y2={height - 1} stroke="var(--line)" />
        {series.map((s) => (
          <polyline key={s.label} points={pts(s.values)} fill="none" stroke={s.color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="spark-legend">
        {series.map((s) => (
          <span key={s.label}>
            <span className="dot" style={{ background: s.color }} />
            {s.label} <span className="mono">{Math.round(s.values[s.values.length - 1])}</span>
          </span>
        ))}
        <span className="muted mono">
          {Math.round(lo)}–{Math.round(hi)}
        </span>
      </div>
    </div>
  );
}

const col = (h: StatsSample[], f: (s: StatsSample) => number) => h.map(f);

function LedgerTable({ title, data }: { title: string; data: Record<string, number> }) {
  const rows = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const net = rows.reduce((s, [, v]) => s + v, 0);
  return (
    <div className="ledger">
      <div className="ledger-title">
        {title}
        <span className={`mono ${net >= 0 ? 'text-ok' : 'text-crit'}`}>{signed(net)}</span>
      </div>
      {rows.length === 0 && <div className="muted small">No transactions yet.</div>}
      {rows.map(([k, v]) => (
        <div className="kv" key={k}>
          <span className="kv-k">{k}</span>
          <span className={`kv-v mono ${v >= 0 ? 'text-ok' : 'text-crit'}`}>{signed(v)}</span>
        </div>
      ))}
    </div>
  );
}

export function StatsPanel() {
  const ctrl = useGame();
  const w = ctrl.world;
  const s = cityStats(w);
  const h = w.history;
  const counts = new Map<string, number>();
  for (const b of w.buildings) counts.set(BUILDING_DEFS[b.type].label, (counts.get(BUILDING_DEFS[b.type].label) ?? 0) + 1);

  return (
    <div className="stats">
      <Section title="Population & mood (last 7 days, hourly)">
        <Sparkline series={[{ label: 'Happiness', color: '#34d399', values: col(h, (x) => x.avgHappiness) }, { label: 'Health', color: '#fb7185', values: col(h, (x) => x.avgHealth) }]} min={0} />
        <Sparkline series={[{ label: 'Population', color: '#7c8cf0', values: col(h, (x) => x.population) }, { label: 'Unemployed', color: '#facc15', values: col(h, (x) => x.unemployed) }, { label: 'Homeless', color: '#ef4444', values: col(h, (x) => x.homeless) }]} min={0} />
      </Section>
      <Section title="Treasury">
        <Sparkline series={[{ label: 'Treasury', color: '#2ee6d6', values: col(h, (x) => x.treasury) }]} />
      </Section>
      <Section title="Power grid">
        <Sparkline series={[{ label: 'Supply', color: '#e3b23c', values: col(h, (x) => x.powerSupply) }, { label: 'Demand', color: '#ef4444', values: col(h, (x) => x.powerDemand) }]} min={0} />
      </Section>
      <Section title="City budget">
        <div className="ledgers">
          <LedgerTable title="Today" data={w.ledger.today} />
          <LedgerTable title="Yesterday" data={w.ledger.yesterday} />
        </div>
      </Section>
      <Section title="Overview">
        <KV k="Citizens" v={s.population} />
        <KV k="Employed" v={`${s.employed} (${percent(1 - s.unemploymentRate)})`} />
        <KV k="Jobs" v={`${s.totalJobs} total · ${s.openJobs} open`} />
        <KV k="Housing" v={`${s.housingCapacity} capacity · ${s.vacantHomes} vacant`} />
        <KV k="Homeless" v={s.homeless} tone={s.homeless ? 'crit' : undefined} />
        <KV k="Closed businesses" v={s.closedBusinesses} tone={s.closedBusinesses ? 'warn' : undefined} />
        <KV k="Avg savings" v={money(s.avgMoney)} />
        <KV k="Avg hunger / energy" v={`${Math.round(s.avgHunger)} / ${Math.round(s.avgEnergy)}`} />
        <KV k="Buildings" v={[...counts.entries()].map(([k, v]) => `${v} ${k}`).join(', ')} />
      </Section>
    </div>
  );
}
