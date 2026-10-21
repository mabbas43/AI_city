import { useState } from 'react';
import {
  ACTION_LABELS,
  BUILDING_DEFS,
  FRIEND_THRESHOLD,
  GOAL_LABELS,
  TICKS_PER_HOUR,
  employeesOf,
  formatTimestamp,
  getBuilding,
  residentsOf,
  workersPresent,
  type Building,
  type Citizen,
} from '../../sim';
import { ECONOMY } from '../../sim/constants';
import { plantOutput } from '../../sim/power';
import { neighbourhood, buildingPollution } from '../../sim/environment';
import { targetHappiness } from '../../sim/needs';
import { ACTION_COLORS, hex } from '../../game/palette';
import { useGame } from '../useGame';
import { buildingName, money } from '../format';
import { Badge, KV, Meter, MiniBar, Section } from './common';

function CitizenLink({ c }: { c: Citizen }) {
  const ctrl = useGame();
  return (
    <button className="link" onClick={() => ctrl.select({ kind: 'citizen', id: c.id })}>
      {c.name}
    </button>
  );
}

function BuildingLink({ b }: { b: Building | undefined }) {
  const ctrl = useGame();
  if (!b) return <span className="muted">none</span>;
  return (
    <button className="link" onClick={() => ctrl.select({ kind: 'building', id: b.id })}>
      {buildingName(b)}
    </button>
  );
}

function activityText(c: Citizen, target: Building | undefined): string {
  const a = c.activity;
  if (a.kind === 'idle') return a.wait > 0 ? 'Waiting' : 'Deciding what to do';
  const where = target ? ` at ${buildingName(target)}` : '';
  if (a.kind === 'traveling') return `Heading out: ${ACTION_LABELS[a.action].toLowerCase()}${where}`;
  return `${ACTION_LABELS[a.action]}${where}`;
}

export function CitizenInspector({ c }: { c: Citizen }) {
  const ctrl = useGame();
  const w = ctrl.world;
  const target = c.activity.kind !== 'idle' ? getBuilding(w, c.activity.targetId) : undefined;
  const action = c.activity.kind === 'idle' ? 'idle' : c.activity.action;
  const home = getBuilding(w, c.homeId);
  const job = getBuilding(w, c.jobId);
  const d = c.lastDecision;
  const relations = Object.entries(c.relationships)
    .map(([id, v]) => ({ other: w.citizens.find((x) => x.id === Number(id)), v }))
    .filter((r): r is { other: Citizen; v: number } => !!r.other)
    .sort((a, b) => b.v - a.v)
    .slice(0, 6);
  const target100 = targetHappiness(c.happinessFactors);
  const remaining =
    c.activity.kind === 'performing' ? Math.max(0, c.activity.maxTicks - c.activity.elapsed) : c.activity.kind === 'traveling' ? c.activity.path.length : 0;

  return (
    <div className="inspector">
      <div className="insp-head">
        <span className="avatar" style={{ borderColor: hex(ACTION_COLORS[action]) }}>
          {c.name
            .split(' ')
            .map((p) => p[0])
            .join('')}
        </span>
        <div>
          <h2>{c.name}</h2>
          <div className="muted">
            {c.age} · {c.occupation}
          </div>
        </div>
      </div>
      <div className="activity-line" style={{ borderColor: hex(ACTION_COLORS[action]) }}>
        <span>{activityText(c, target)}</span>
        {remaining > 0 && <span className="muted mono">{c.activity.kind === 'traveling' ? `${remaining} tiles` : `${remaining * 5} min`}</span>}
      </div>

      <Section title="Needs">
        <div className="meters">
          <Meter label="Energy" value={c.needs.energy} />
          <Meter label="Hunger" value={c.needs.hunger} invert />
          <Meter label="Health" value={c.needs.health} />
          <Meter label="Happiness" value={c.needs.happiness} suffix={`${Math.round(c.needs.happiness)} → ${Math.round(target100)}`} />
        </div>
      </Section>

      <Section title="Livelihood">
        <KV k="Money" v={money(c.money)} tone={c.money < 25 ? 'crit' : undefined} />
        <KV k="Wage" v={c.wage ? `${(c.wage * TICKS_PER_HOUR).toFixed(1)} cr/h gross` : '—'} />
        <KV k="Earned today" v={money(c.incomeToday)} />
        {c.unpaidToday > 0 && <KV k="Unpaid today" v={money(c.unpaidToday)} tone="crit" />}
        <KV k="Groceries" v={`${c.food} portions`} tone={c.food === 0 ? 'warn' : undefined} />
        <KV k="Home" v={<BuildingLink b={home} />} tone={!home ? 'crit' : undefined} />
        <KV k="Workplace" v={<BuildingLink b={job} />} />
      </Section>

      {d && (
        <Section title="Why this choice" aside={<span className="muted mono">{formatTimestamp(d.tick)}</span>}>
          <div className="decision">
            <div className="decision-main">
              <span className="dot" style={{ background: hex(ACTION_COLORS[d.action]) }} />
              <strong>{ACTION_LABELS[d.action]}</strong>
              <span className="muted">{d.targetId !== null ? buildingName(getBuilding(w, d.targetId)) : ''}</span>
              <span className="mono score">{d.score.toFixed(2)}</span>
            </div>
            <ul className="reasons">
              {d.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <div className="alts">
              {d.alternatives.map((a) => (
                <div className="alt" key={`${a.action}-${a.targetId}`}>
                  <span>{ACTION_LABELS[a.action]}</span>
                  <MiniBar value={Math.max(0, a.score) / Math.max(0.01, d.score)} tone="muted" />
                  <span className="mono muted">{a.score.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        </Section>
      )}

      <Section title="Happiness factors">
        <div className="factors">
          {c.happinessFactors.map((f) => (
            <div className="factor" key={f.label}>
              <span>{f.label}</span>
              <span className={`mono ${f.value >= 0 ? 'text-ok' : 'text-crit'}`}>{f.value >= 0 ? `+${f.value}` : f.value}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Goals">
        {c.goals.map((g, i) => (
          <div className="goal" key={i}>
            <div className="goal-head">
              <span>{GOAL_LABELS[g.kind](g)}</span>
              <span className="mono muted">
                {g.progress}/{g.target}
              </span>
            </div>
            <MiniBar value={g.progress / g.target} />
          </div>
        ))}
      </Section>

      <Section title="Personality & skills">
        <div className="traits">
          {Object.entries(c.traits).map(([k, v]) => (
            <div className="trait" key={k}>
              <span>{k}</span>
              <MiniBar value={v} tone="accent" />
            </div>
          ))}
          {Object.entries(c.skills).map(([k, v]) => (
            <div className="trait" key={k}>
              <span>{k}</span>
              <MiniBar value={v} tone="violet" />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Relationships">
        {relations.length === 0 && <div className="muted small">Has not met anyone yet.</div>}
        {relations.map(({ other, v }) => (
          <div className="relation" key={other.id}>
            <CitizenLink c={other} />
            {v >= FRIEND_THRESHOLD && <Badge tone="ok">friend</Badge>}
            <MiniBar value={(v + 100) / 200} tone={v >= FRIEND_THRESHOLD ? 'ok' : 'muted'} />
            <span className="mono muted">{Math.round(v)}</span>
          </div>
        ))}
      </Section>

      <Section title="Experiences">
        {c.memories.length === 0 && <div className="muted small">Nothing memorable yet.</div>}
        <ul className="memories">
          {[...c.memories].reverse().slice(0, 12).map((m, i) => (
            <li key={i} className={m.impact >= 0 ? 'mem-pos' : 'mem-neg'}>
              <span className="mono muted">{formatTimestamp(m.tick)}</span>
              <span>{m.text}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

export function BuildingInspector({ b }: { b: Building }) {
  const ctrl = useGame();
  const w = ctrl.world;
  const d = BUILDING_DEFS[b.type];
  const [confirm, setConfirm] = useState(false);
  const residents = residentsOf(w, b.id);
  const staff = employeesOf(w, b.id);
  const onDuty = workersPresent(w, b.id).length;
  const visitors = w.citizens.filter((c) => c.insideId === b.id && c.activity.kind === 'performing' && c.activity.action !== 'work' && c.homeId !== b.id);
  const isBusiness = !d.isPublic && d.jobs > 0;

  return (
    <div className="inspector">
      <div className="insp-head">
        <div>
          <h2>{buildingName(b)}</h2>
          <div className="muted">{d.description}</div>
        </div>
      </div>
      <div className="badges">
        {b.status === 'closed' ? <Badge tone="crit">Closed</Badge> : <Badge tone="ok">Open</Badge>}
        {d.powerDemand > 0 && (b.powered ? <Badge tone="ok">Powered</Badge> : <Badge tone="crit">No power</Badge>)}
        {b.connected ? <Badge tone="muted">Road access</Badge> : <Badge tone="warn">No road access</Badge>}
        {b.distressHours > 0 && <Badge tone="warn">Distress {b.distressHours}h</Badge>}
        {b.unpaidUpkeepHours > 0 && <Badge tone="crit">Upkeep overdue {b.unpaidUpkeepHours}h</Badge>}
      </div>

      <Section title="Operations">
        {d.housing > 0 && <KV k="Residents" v={`${residents.length} / ${d.housing}`} />}
        {d.jobs > 0 && <KV k="Staff" v={`${staff.length} / ${d.jobs} (${onDuty} on duty)`} tone={staff.length === 0 ? 'warn' : undefined} />}
        {d.jobs > 0 && <KV k="Wage" v={`${(d.baseWage * TICKS_PER_HOUR).toFixed(1)} cr/h base`} />}
        {d.powerDemand > 0 && <KV k="Power draw" v={`${d.powerDemand}`} />}
        {d.powerSupply > 0 && <KV k="Power output" v={`${plantOutput(w, b)} / ${d.powerSupply}`} />}
        {d.upkeepPerDay > 0 && <KV k="City upkeep" v={`${d.upkeepPerDay} cr/day`} />}
        {d.rentPerDay > 0 && <KV k="Rent" v={`${d.rentPerDay} cr/day each`} />}
        {(b.type === 'shop' || b.type === 'market' || b.type === 'factory') && <KV k={b.type === 'factory' ? 'Warehouse' : 'Shelf stock'} v={`${Math.floor(b.stock)} goods`} tone={b.stock < 1 ? 'crit' : undefined} />}
        {visitors.length > 0 && <KV k="Visitors" v={visitors.length} />}
      </Section>

      {d.housing > 0 && <NeighbourhoodSection b={b} />}
      {(b.type === 'factory' || b.type === 'powerStation') && (
        <Section title="Environment">
          <KV k="Air pollution here" v={`${Math.round(buildingPollution(w, b) * 100)}%`} tone="warn" />
          <div className="muted small">Homes within about {b.type === 'factory' ? 7 : 5} tiles breathe its smog while it runs. Parks nearby clean the air.</div>
        </Section>
      )}

      {isBusiness && (
        <Section title="Finances">
          <KV k="Cash" v={money(b.funds)} tone={b.funds < 100 ? 'crit' : undefined} />
          <KV k="Revenue today" v={money(b.today.revenue)} />
          <KV k="Wages paid today" v={money(b.today.wagesPaid)} />
          {b.today.wagesUnpaid > 0 && <KV k="Wages unpaid" v={money(b.today.wagesUnpaid)} tone="crit" />}
          <KV k="Yesterday" v={`${money(b.yesterday.revenue)} in · ${money(b.yesterday.wagesPaid)} wages`} />
          {(b.type === 'shop' || b.type === 'market') && <KV k="Items sold today" v={b.today.sales} />}
        </Section>
      )}

      {staff.length > 0 && (
        <Section title="Employees">
          <div className="people">
            {staff.map((c) => (
              <CitizenLink key={c.id} c={c} />
            ))}
          </div>
        </Section>
      )}
      {residents.length > 0 && (
        <Section title="Residents">
          <div className="people">
            {residents.map((c) => (
              <CitizenLink key={c.id} c={c} />
            ))}
          </div>
        </Section>
      )}

      <div className="actions">
        {isBusiness && (
          <button className="btn btn-accent" onClick={() => ctrl.subsidize(b.id)} disabled={w.treasury < ECONOMY.subsidyAmount}>
            {b.status === 'closed' ? 'Bail out & reopen' : 'Subsidize'} ({ECONOMY.subsidyAmount} cr)
          </button>
        )}
        {b.type !== 'cityHall' &&
          (confirm ? (
            <>
              <button className="btn btn-danger" onClick={() => ctrl.demolishSelected()}>
                Confirm demolish
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirm(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className="btn btn-ghost" onClick={() => setConfirm(true)}>
              Demolish
            </button>
          ))}
      </div>
    </div>
  );
}

function NeighbourhoodSection({ b }: { b: Building }) {
  const w = useGame().world;
  const n = neighbourhood(w, b);
  const residents = residentsOf(w, b.id);
  const mood = residents.length ? residents.reduce((s, c) => s + c.needs.happiness, 0) / residents.length : null;
  const pollTone = n.pollution > 0.4 ? 'crit' : n.pollution > 0.1 ? 'warn' : 'ok';
  return (
    <Section title="Neighbourhood">
      <KV k="Air pollution" v={n.pollution > 0.1 ? `${Math.round(n.pollution * 100)}%` : 'clean'} tone={pollTone} />
      <KV k="Park within reach" v={n.park ? 'yes' : 'no'} tone={n.park ? 'ok' : 'warn'} />
      <KV k="Working clinic" v={n.clinic ? 'yes' : 'no'} tone={n.clinic ? 'ok' : 'warn'} />
      <KV k="Staffed school" v={n.school ? 'yes' : 'no'} tone={n.school ? 'ok' : undefined} />
      {mood !== null && <KV k="Residents' mood" v={Math.round(mood)} tone={mood >= 60 ? 'ok' : mood >= 35 ? 'warn' : 'crit'} />}
    </Section>
  );
}

export function Inspector() {
  const ctrl = useGame();
  const sel = ctrl.selection;
  const w = ctrl.world;
  if (sel?.kind === 'citizen') {
    const c = w.citizens.find((x) => x.id === sel.id);
    if (c) return <CitizenInspector c={c} />;
  }
  if (sel?.kind === 'building') {
    const b = getBuilding(w, sel.id);
    if (b) return <BuildingInspector key={b.id} b={b} />;
  }
  return (
    <div className="empty">
      <h3>Nothing selected</h3>
      <p>Click a citizen on the map or in the Citizens tab to see their needs, goals, relationships and the reasoning behind their current action.</p>
      <p>Click a building to see its staff, finances and power status.</p>
      <p className="muted small">Citizens inside buildings are shown as lit windows. {TICKS_PER_HOUR} ticks = 1 hour.</p>
    </div>
  );
}
