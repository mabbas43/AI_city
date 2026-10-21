import { useState } from 'react';
import { POLICY_LIMITS, type Policies } from '../../sim';
import { useGame } from '../useGame';
import { Section } from './common';

type NumericPolicy = keyof typeof POLICY_LIMITS;

const INFO: Record<NumericPolicy, { label: string; help: string; fmt: (v: number) => string }> = {
  incomeTaxRate: {
    label: 'Income tax',
    help: 'Withheld from every wage. Above 15% citizens grow unhappy; below 10% they are pleased.',
    fmt: (v) => `${Math.round(v * 100)}%`,
  },
  salesTaxRate: {
    label: 'Sales tax',
    help: 'Taken from each retail sale. Higher rates squeeze shop margins and can push shops towards closure.',
    fmt: (v) => `${Math.round(v * 100)}%`,
  },
  unemploymentBenefit: {
    label: 'Unemployment benefit',
    help: 'Paid daily from the treasury to every jobless citizen so they can afford food and rent.',
    fmt: (v) => `${v} cr/day`,
  },
};

function PolicySlider({ k, value, onApply }: { k: NumericPolicy; value: number; onApply: (v: number) => void }) {
  const [draft, setDraft] = useState<number | null>(null);
  const lim = POLICY_LIMITS[k];
  const info = INFO[k];
  const shown = draft ?? value;
  const changed = draft !== null && Math.abs(draft - value) > 1e-9;
  return (
    <div className="policy">
      <div className="policy-head">
        <span>{info.label}</span>
        <span className="mono">{info.fmt(shown)}</span>
      </div>
      <input type="range" min={lim.min} max={lim.max} step={lim.step} value={shown} onChange={(e) => setDraft(Number(e.target.value))} />
      <p className="muted small">{info.help}</p>
      {changed && (
        <div className="policy-actions">
          <button
            className="btn btn-accent"
            onClick={() => {
              onApply(Math.round(draft! / lim.step) * lim.step);
              setDraft(null);
            }}
          >
            Enact {info.fmt(draft!)}
          </button>
          <button className="btn btn-ghost" onClick={() => setDraft(null)}>
            Revert
          </button>
        </div>
      )}
    </div>
  );
}

export function PoliciesPanel() {
  const ctrl = useGame();
  const p = ctrl.world.policies;
  const apply = <K extends keyof Policies>(k: K, v: Policies[K]) => ctrl.setPolicy(k, v);
  return (
    <div className="policies">
      <Section title="Fiscal policy">
        {(Object.keys(INFO) as NumericPolicy[]).map((k) => (
          <PolicySlider key={k} k={k} value={p[k]} onApply={(v) => apply(k, Number(v.toFixed(2)))} />
        ))}
      </Section>
      <Section title="Energy policy">
        <label className="toggle">
          <input type="checkbox" checked={p.energyConservation} onChange={(e) => apply('energyConservation', e.target.checked)} />
          <span>
            <strong>Energy conservation</strong>
            <span className="muted small block">Cuts every building's power draw by 20%. Citizens dislike the rationing (−3 happiness).</span>
          </span>
        </label>
      </Section>
    </div>
  );
}
