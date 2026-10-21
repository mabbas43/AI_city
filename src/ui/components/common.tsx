import type { ReactNode } from 'react';

export function Meter({ label, value, invert = false, suffix }: { label: string; value: number; invert?: boolean; suffix?: string }) {
  const v = Math.max(0, Math.min(100, value));
  const good = invert ? 100 - v : v;
  const tone = good >= 60 ? 'ok' : good >= 30 ? 'warn' : 'crit';
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <span className="mono">{suffix ?? Math.round(v)}</span>
      </div>
      <div className="meter-track">
        <div className={`meter-fill tone-${tone}`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

export function MiniBar({ value, tone = 'accent' }: { value: number; tone?: string }) {
  return (
    <div className="minibar">
      <div className={`minibar-fill tone-${tone}`} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="section">
      <header className="section-head">
        <h3>{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function KV({ k, v, tone }: { k: string; v: ReactNode; tone?: string }) {
  return (
    <div className="kv">
      <span className="kv-k">{k}</span>
      <span className={`kv-v mono ${tone ? `text-${tone}` : ''}`}>{v}</span>
    </div>
  );
}

export function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'crit' | 'muted' | 'accent'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Dot({ color }: { color: string }) {
  return <span className="dot" style={{ background: color }} />;
}
