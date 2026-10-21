import { useEffect, useMemo, useState } from 'react';
import { SPEEDS } from '../sim';
import { GameController } from '../game/controller';
import { PhaserCity } from '../game/PhaserCity';
import { GameContext, useGame } from './useGame';
import { TopBar } from './components/TopBar';
import { Toolbar } from './components/Toolbar';
import { Inspector } from './components/Inspector';
import { EventLog } from './components/EventLog';
import { StatsPanel } from './components/StatsPanel';
import { PoliciesPanel } from './components/PoliciesPanel';
import { CitizensList } from './components/CitizensList';
import { MayorPanel } from './components/MayorPanel';
import { BulletinCard, PetitionCards } from './components/Overlays';
import { GameOverModal, NewGameModal } from './components/Modals';

type Tab = 'inspect' | 'mayor' | 'citizens' | 'city' | 'policy';
const TABS: { id: Tab; label: string }[] = [
  { id: 'inspect', label: 'Inspect' },
  { id: 'mayor', label: 'Mayor' },
  { id: 'citizens', label: 'Citizens' },
  { id: 'city', label: 'Stats' },
  { id: 'policy', label: 'Policies' },
];

function Sidebar() {
  const ctrl = useGame();
  const [tab, setTab] = useState<Tab>('inspect');
  const selKey = ctrl.selection ? `${ctrl.selection.kind}:${ctrl.selection.id}` : '';
  // Jump to the inspector whenever something new is selected.
  useEffect(() => {
    if (selKey) setTab('inspect');
  }, [selKey]);
  return (
    <aside className="sidebar">
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === 'mayor' && ctrl.world.petitions.length > 0 && <span className="tab-dot" />}
          </button>
        ))}
      </nav>
      <div className="sidebar-body">
        {tab === 'inspect' && <Inspector />}
        {tab === 'mayor' && <MayorPanel />}
        {tab === 'citizens' && <CitizensList />}
        {tab === 'city' && <StatsPanel />}
        {tab === 'policy' && <PoliciesPanel />}
      </div>
    </aside>
  );
}

function Toasts() {
  const ctrl = useGame();
  return (
    <div className="toasts">
      {ctrl.toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

function ToolHint() {
  const ctrl = useGame();
  const t = ctrl.tool;
  if (t.kind === 'select') return null;
  const text = t.kind === 'road' ? 'Click or drag to lay roads' : t.kind === 'bulldoze' ? 'Click a building or road to demolish' : 'Click a highlighted spot next to a road to build';
  return (
    <div className="tool-hint-banner">
      {text} · <kbd>Esc</kbd> to cancel · right-drag to pan · scroll to zoom
    </div>
  );
}

function Modals() {
  const ctrl = useGame();
  if (ctrl.modal === 'newGame') return <NewGameModal />;
  if (ctrl.modal === 'gameOver') return <GameOverModal />;
  return null;
}

function useShortcuts(ctrl: GameController) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (ctrl.modal !== 'none') return;
      if (e.code === 'Space') {
        e.preventDefault();
        ctrl.togglePause();
      } else if (/^Digit[1-4]$/.test(e.code)) ctrl.setSpeed(SPEEDS[Number(e.code.slice(5)) - 1]);
      else if (e.key === 'Escape') {
        if (ctrl.tool.kind !== 'select') ctrl.setTool({ kind: 'select' });
        else ctrl.select(null);
      } else if (e.key === 'r' || e.key === 'R') ctrl.setTool({ kind: 'road' });
      else if (e.key === 'b' || e.key === 'B') ctrl.setTool({ kind: 'bulldoze' });
      else if (e.key === 'v' || e.key === 'V') ctrl.setTool({ kind: 'select' });
      else if (e.key === 'o' || e.key === 'O') ctrl.cycleOverlay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctrl]);
}

export function App() {
  const ctrl = useMemo(() => new GameController(), []);
  useEffect(() => {
    // Debug handle for the dev server only (e.g. `__city.world.weather.kind = 'storm'`).
    if (import.meta.env.DEV) (window as unknown as { __city: GameController }).__city = ctrl;
    ctrl.start();
    return () => ctrl.stop();
  }, [ctrl]);
  useShortcuts(ctrl);

  return (
    <GameContext.Provider value={ctrl}>
      <div className="app">
        <TopBar />
        <Toolbar />
        <main className="center">
          <div className="map-wrap">
            <PhaserCity controller={ctrl} />
            <ToolHint />
            <PetitionCards />
            <BulletinCard />
            <Toasts />
          </div>
          <EventLog />
        </main>
        <Sidebar />
        <Modals />
      </div>
    </GameContext.Provider>
  );
}
