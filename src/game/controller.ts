// GameController owns the world, the fixed-step clock and UI selection state.
// React subscribes for coarse updates; Phaser reads the world every frame.

import {
  FixedStepClock,
  bulldoze,
  checkBuildingPlacement,
  checkRoadPlacement,
  createWorld,
  placeBuilding,
  placeRoad,
  setPolicy,
  stepWorld,
  subsidizeBuilding,
  type BuildingType,
  type CommandResult,
  type Difficulty,
  type Policies,
  type Speed,
  type World,
} from '../sim';
import { demolishBuilding } from '../sim/construction';
import { getBuilding } from '../sim/buildings';
import { loadFromStorage, saveToStorage, SAVE_KEY, type KeyValueStorage } from '../sim/persistence';
import { resolvePetition } from '../sim/petitions';

export type Tool = { kind: 'select' } | { kind: 'road' } | { kind: 'bulldoze' } | { kind: 'build'; type: BuildingType };
export type Selection = { kind: 'citizen'; id: number } | { kind: 'building'; id: number } | null;
export type MapOverlay = 'none' | 'pollution' | 'services' | 'happiness';
export const OVERLAYS: { id: MapOverlay; label: string }[] = [
  { id: 'none', label: 'Normal' },
  { id: 'pollution', label: 'Pollution' },
  { id: 'services', label: 'Services' },
  { id: 'happiness', label: 'Happiness' },
];
export type Modal = 'none' | 'newGame' | 'gameOver';

const INTRO_KEY = 'ai-city:intro-seen';
/** Event types announced with a toast as they happen. */
const ANNOUNCE: Partial<Record<string, Toast['kind']>> = { milestone: 'success', election: 'success', petition: 'info' };

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
}

const UI_NOTIFY_MS = 200;

export class GameController {
  world: World;
  readonly clock = new FixedStepClock({ baseStepMs: 125 });
  tool: Tool = { kind: 'select' };
  selection: Selection = null;
  toasts: Toast[] = [];
  /** Bumped whenever tiles or buildings change, so the renderer can rebuild static layers. */
  mapVersion = 0;
  /** Automatically pause when a critical event fires. */
  pauseOnCritical = false;
  /** Automatically pause when a petition needs an answer (petitions expire within game hours, i.e. seconds). */
  pauseOnPetition = true;
  overlay: MapOverlay = 'none';
  modal: Modal = 'none';
  /** Tick of the newest bulletin the player has dismissed. */
  bulletinSeen = -1;
  /** True until the player has dismissed the welcome screen once. */
  firstVisit = false;
  private version = 0;
  private listeners = new Set<() => void>();
  private rafId: number | null = null;
  private lastFrame = 0;
  private lastNotify = 0;
  private dirty = false;
  private toastSeq = 0;

  constructor(private storage: KeyValueStorage | null = typeof localStorage !== 'undefined' ? localStorage : null) {
    this.world = createWorld({ seed: Math.floor(Math.random() * 1e9) });
    // First visit: show the welcome screen with the city still paused.
    if (!this.readStorage(INTRO_KEY)) {
      this.firstVisit = true;
      this.modal = 'newGame';
      this.clock.pause();
    }
  }

  private readStorage(key: string): string | null {
    try {
      return this.storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  // ---- subscription (useSyncExternalStore) ----
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  private notify(): void {
    this.version += 1;
    this.dirty = false;
    this.lastNotify = performance.now();
    for (const l of this.listeners) l();
  }

  // ---- main loop ----
  start(): void {
    if (this.rafId !== null) return;
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      this.frame(now - this.lastFrame);
      this.lastFrame = now;
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  /** Advance by real elapsed milliseconds. Public for tests and tooling. */
  frame(elapsedMs: number): void {
    const ticks = this.clock.update(elapsedMs);
    for (let i = 0; i < ticks; i++) {
      const before = this.world.nextEventId;
      const petitions = this.world.petitions.length;
      stepWorld(this.world);
      const fresh = this.world.nextEventId > before ? this.world.events.filter((e) => e.id >= before) : [];
      for (const e of fresh) {
        const kind = ANNOUNCE[e.type];
        if (kind && (e.type !== 'petition' || e.title.startsWith('Decision needed'))) this.toast(kind, e.title);
      }
      if (this.world.gameOver) {
        this.clock.pause();
        this.modal = 'gameOver';
        break;
      }
      if (this.pauseOnPetition && this.world.petitions.length > petitions) {
        this.clock.pause();
        this.toast('info', 'Paused: a decision needs your answer');
        break;
      }
      if (this.pauseOnCritical) {
        const critical = fresh.find((e) => e.severity === 'critical');
        if (critical) {
          this.clock.pause();
          this.toast('info', `Paused: ${critical.title}`);
          break;
        }
      }
    }
    if (ticks > 0) this.dirty = true;
    if (this.dirty && performance.now() - this.lastNotify >= UI_NOTIFY_MS) this.notify();
  }

  // ---- time controls ----
  togglePause(): void {
    if (this.modal !== 'none') return;
    if (this.clock.paused) this.clock.resume();
    else this.clock.pause();
    this.notify();
  }

  setSpeed(speed: Speed): void {
    if (this.modal !== 'none') return;
    this.clock.setSpeed(speed);
    if (this.clock.paused) this.clock.resume();
    this.notify();
  }

  setPauseOnCritical(on: boolean): void {
    this.pauseOnCritical = on;
    this.notify();
  }

  setPauseOnPetition(on: boolean): void {
    this.pauseOnPetition = on;
    this.notify();
  }

  setOverlay(overlay: MapOverlay): void {
    this.overlay = overlay;
    this.notify();
  }

  cycleOverlay(): void {
    const i = OVERLAYS.findIndex((o) => o.id === this.overlay);
    this.setOverlay(OVERLAYS[(i + 1) % OVERLAYS.length].id);
  }

  // ---- mayor decisions ----
  answerPetition(petitionId: number, optionId: string): void {
    const r = resolvePetition(this.world, petitionId, optionId);
    if (!r.ok && r.reason) this.toast('error', r.reason);
    this.mapVersion += 1;
    this.notify();
  }

  dismissBulletin(): void {
    const latest = this.world.bulletins[this.world.bulletins.length - 1];
    if (latest) this.bulletinSeen = latest.tick;
    this.notify();
  }

  /** After losing an election: keep playing without elections. */
  continueSandbox(): void {
    this.world.sandbox = true;
    this.world.gameOver = null;
    this.modal = 'none';
    this.clock.resume();
    this.toast('info', 'Sandbox mode: no more elections');
  }

  openModal(modal: Modal): void {
    this.modal = modal;
    if (modal !== 'none') this.clock.pause();
    this.notify();
  }

  closeModal(): void {
    if (this.modal === 'gameOver') return;
    this.modal = 'none';
    this.firstVisit = false;
    try {
      this.storage?.setItem(INTRO_KEY, '1');
    } catch {
      // Storage may be unavailable (private mode); the intro will just show again.
    }
    this.clock.resume();
    this.notify();
  }

  // ---- tools & selection ----
  setTool(tool: Tool): void {
    this.tool = tool;
    this.notify();
  }

  select(selection: Selection): void {
    this.selection = selection;
    this.notify();
  }

  /** Validates (without applying) the current tool at a tile, for placement previews. */
  previewTool(x: number, y: number): CommandResult {
    const t = this.tool;
    if (t.kind === 'build') return checkBuildingPlacement(this.world, t.type, x, y);
    if (t.kind === 'road') return checkRoadPlacement(this.world, x, y);
    return { ok: true };
  }

  applyTool(x: number, y: number, quiet = false): CommandResult {
    const t = this.tool;
    let result: CommandResult;
    if (t.kind === 'build') result = placeBuilding(this.world, t.type, x, y);
    else if (t.kind === 'road') result = placeRoad(this.world, x, y);
    else if (t.kind === 'bulldoze') result = bulldoze(this.world, x, y);
    else return { ok: false };
    if (result.ok) {
      this.mapVersion += 1;
      if (t.kind === 'build' && result.building) this.selection = { kind: 'building', id: result.building.id };
    } else if (!quiet && result.reason) {
      this.toast('error', result.reason);
    }
    this.notify();
    return result;
  }

  demolishSelected(): void {
    const sel = this.selection;
    if (sel?.kind !== 'building') return;
    const b = getBuilding(this.world, sel.id);
    if (!b) return;
    const r = demolishBuilding(this.world, b);
    if (r.ok) {
      this.selection = null;
      this.mapVersion += 1;
    } else if (r.reason) this.toast('error', r.reason);
    this.notify();
  }

  subsidize(buildingId: number): void {
    const r = subsidizeBuilding(this.world, buildingId);
    this.toast(r.ok ? 'success' : 'error', r.ok ? 'Subsidy granted' : r.reason ?? 'Subsidy failed');
    this.notify();
  }

  setPolicy<K extends keyof Policies>(key: K, value: Policies[K]): void {
    const r = setPolicy(this.world, key, value);
    if (!r.ok && r.reason) this.toast('error', r.reason);
    this.notify();
  }

  // ---- persistence ----
  save(): void {
    if (!this.storage) return this.toast('error', 'Browser storage is unavailable');
    const r = saveToStorage(this.storage, this.world, new Date().toISOString());
    this.toast(r.ok ? 'success' : 'error', r.ok ? 'City saved' : r.error);
  }

  load(): void {
    if (!this.storage) return this.toast('error', 'Browser storage is unavailable');
    const r = loadFromStorage(this.storage);
    if (!r.ok) return this.toast('error', r.error);
    this.world = r.world;
    this.selection = null;
    this.mapVersion += 1;
    this.bulletinSeen = this.world.bulletins.at(-1)?.tick ?? -1;
    this.modal = this.world.gameOver ? 'gameOver' : 'none';
    this.toast('success', `Loaded save from ${r.savedAt ? new Date(r.savedAt).toLocaleString() : 'an unknown time'}`);
  }

  hasSave(): boolean {
    try {
      return !!this.storage?.getItem(SAVE_KEY);
    } catch {
      return false;
    }
  }

  newGame(seed = Math.floor(Math.random() * 1e9), difficulty: Difficulty = 'standard'): void {
    this.world = createWorld({ seed, difficulty });
    this.selection = null;
    this.mapVersion += 1;
    this.bulletinSeen = -1;
    this.modal = 'none';
    this.closeModal();
    this.toast('info', `New city founded (seed ${seed})`);
  }

  // ---- toasts ----
  toast(kind: Toast['kind'], text: string): void {
    const t = { id: ++this.toastSeq, kind, text };
    this.toasts = [...this.toasts.slice(-3), t];
    this.notify();
    setTimeout(() => {
      this.toasts = this.toasts.filter((x) => x.id !== t.id);
      this.notify();
    }, 3200);
  }
}
