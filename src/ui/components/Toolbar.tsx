import { BUILDABLE_TYPES, BUILDING_DEFS, ACTION_LABELS, lockedReason, type BuildingType } from '../../sim';
import { ROAD_COST, type BuildingCategory } from '../../sim/buildings';
import { ACTION_COLORS, BUILDING_ACCENT, CATEGORY_COLORS, hex } from '../../game/palette';
import { OVERLAYS, type Tool } from '../../game/controller';
import { useGame } from '../useGame';

const CATEGORY_LABELS: Record<BuildingCategory, string> = {
  residential: 'Housing',
  commercial: 'Commerce',
  industrial: 'Industry',
  energy: 'Energy',
  public: 'Public services',
};

function summary(type: BuildingType): string {
  const d = BUILDING_DEFS[type];
  const parts: string[] = [];
  if (d.housing) parts.push(`${d.housing} homes`);
  if (d.jobs) parts.push(`${d.jobs} jobs`);
  if (d.powerSupply) parts.push(`+${d.powerSupply} pwr`);
  if (d.powerDemand) parts.push(`−${d.powerDemand} pwr`);
  if (d.upkeepPerDay) parts.push(`${d.upkeepPerDay}/day`);
  return parts.join(' · ');
}

function sameTool(a: Tool, b: Tool): boolean {
  return a.kind === b.kind && (a.kind !== 'build' || (b.kind === 'build' && a.type === b.type));
}

function ToolButton({ t, current, onPick, label, hint, k }: { t: Tool; current: Tool; onPick: (t: Tool) => void; label: string; hint: string; k: string }) {
  return (
    <button className={`tool ${sameTool(current, t) ? 'active' : ''}`} onClick={() => onPick(t)} title={`${label} (${k})`}>
      <span className="tool-label">{label}</span>
      <span className="tool-hint">{hint}</span>
      <kbd>{k}</kbd>
    </button>
  );
}

export function Toolbar() {
  const ctrl = useGame();
  const treasury = ctrl.world.treasury;
  const tool = ctrl.tool;
  const pick = (t: Tool) => ctrl.setTool(t);
  const categories = [...new Set(BUILDABLE_TYPES.map((t) => BUILDING_DEFS[t].category))];

  return (
    <aside className="toolbar">
      <div className="toolbar-group">
        <div className="group-title">Tools</div>
        <ToolButton current={tool} onPick={pick} t={{ kind: 'select' }} label="Inspect" hint="Click citizens & buildings" k="V" />
        <ToolButton current={tool} onPick={pick} t={{ kind: 'road' }} label="Road" hint={`${ROAD_COST} cr per tile · drag`} k="R" />
        <ToolButton current={tool} onPick={pick} t={{ kind: 'bulldoze' }} label="Demolish" hint="50% refund on buildings" k="B" />
      </div>

      {categories.map((cat) => (
        <div className="toolbar-group" key={cat}>
          <div className="group-title">{CATEGORY_LABELS[cat]}</div>
          {BUILDABLE_TYPES.filter((t) => BUILDING_DEFS[t].category === cat).map((type) => {
            const d = BUILDING_DEFS[type];
            const t: Tool = { kind: 'build', type };
            const afford = treasury >= d.cost;
            const locked = lockedReason(ctrl.world, type);
            return (
              <button
                key={type}
                className={`build ${sameTool(tool, t) ? 'active' : ''} ${afford && !locked ? '' : 'unaffordable'}`}
                onClick={() => !locked && ctrl.setTool(t)}
                disabled={!!locked}
                title={locked ? `${d.description} (${locked})` : d.description}
              >
                <span className="build-swatch" style={{ background: hex(BUILDING_ACCENT[type] ?? CATEGORY_COLORS[d.category]) }} />
                <span className="build-body">
                  <span className="build-row">
                    <span className="build-name">{d.label}</span>
                    <span className={`build-cost mono ${afford ? '' : 'text-crit'}`}>{d.cost}</span>
                  </span>
                  <span className="build-meta">{locked ? `🔒 ${locked}` : summary(type)}</span>
                </span>
              </button>
            );
          })}
        </div>
      ))}

      <div className="toolbar-group">
        <div className="group-title">
          Map view <kbd>O</kbd>
        </div>
        <div className="overlay-grid">
          {OVERLAYS.map((o) => (
            <button key={o.id} className={`seg-btn overlay-btn ${ctrl.overlay === o.id ? 'active' : ''}`} onClick={() => ctrl.setOverlay(o.id)}>
              {o.label}
            </button>
          ))}
        </div>
        {ctrl.overlay !== 'none' && <OverlayLegend kind={ctrl.overlay} />}
      </div>

      <div className="toolbar-group legend">
        <div className="group-title">Citizen activity</div>
        <div className="legend-grid">
          {(['work', 'rest', 'eat', 'shop', 'socialize', 'seekJob', 'seekCare', 'protest'] as const).map((a) => (
            <span key={a} className="legend-item">
              <span className="dot" style={{ background: hex(ACTION_COLORS[a]) }} />
              {ACTION_LABELS[a]}
            </span>
          ))}
        </div>
      </div>
    </aside>
  );
}

const LEGENDS: Record<string, { text: string; from: string; to: string }> = {
  pollution: { text: 'Factory and plant smog; parks clean the air', from: 'clean', to: 'smoggy' },
  services: { text: 'Homes reached by a park, clinic and school', from: 'none', to: 'all 3' },
  happiness: { text: 'Average mood of each home’s residents', from: 'miserable', to: 'happy' },
};

function OverlayLegend({ kind }: { kind: string }) {
  const l = LEGENDS[kind];
  return (
    <div className="overlay-legend">
      <div className={`legend-ramp ramp-${kind}`} />
      <div className="legend-ends small muted">
        <span>{l.from}</span>
        <span>{l.to}</span>
      </div>
      <div className="small muted">{l.text}</div>
    </div>
  );
}
