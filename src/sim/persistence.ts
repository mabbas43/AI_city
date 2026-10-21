// Versioned save format with strict validation. Loading never mutates the
// running game: callers receive either a fully validated world or an error.

import { approvalFactors, targetApproval, TERM_DAYS } from './approval';
import { BUILDING_DEFS } from './buildings';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from './constants';
import { refreshEntrances } from './map';
import { POLICY_LIMITS } from './policies';
import type { ActionKind, BuildingType, World } from './types';

export const SAVE_FORMAT = 'ai-city-save';
export const SAVE_VERSION = 2;

export interface SaveFile {
  format: typeof SAVE_FORMAT;
  version: number;
  savedAt: string;
  world: World;
}

export type LoadResult = { ok: true; world: World; savedAt: string } | { ok: false; error: string };

/** Upgraders from version N to N+1. */
export const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  // v2 added weather, approval and elections, milestones, petitions, effects and bulletins.
  1: (file) => {
    const w = isObj(file.world) ? { ...file.world } : {};
    const tick = isInt(w.tick) ? (w.tick as number) : 0;
    const termTicks = TERM_DAYS * TICKS_PER_DAY;
    w.difficulty = 'standard';
    w.weather = { kind: 'clear', untilTick: tick + 6 * TICKS_PER_HOUR, forecast: 'cloudy' };
    w.approval = { value: 50, factors: [], modifiers: [] };
    w.election = { nextTick: (Math.floor(tick / termTicks) + 1) * termTicks, term: 1, history: [] };
    w.milestones = {};
    w.petitions = [];
    w.nextPetitionId = 1;
    w.effects = [];
    w.bulletins = [];
    w.gameOver = null;
    w.sandbox = false;
    return { ...file, version: 2, world: w };
  },
};

const WEATHER_KINDS = ['clear', 'cloudy', 'rain', 'storm', 'heatwave'];
const EFFECT_KINDS = ['festival', 'powerImport', 'coolingCenters', 'parkPromise'];

export function serializeWorld(world: World, savedAt: string): string {
  const file: SaveFile = { format: SAVE_FORMAT, version: SAVE_VERSION, savedAt, world };
  return JSON.stringify(file);
}

const ACTIONS: ActionKind[] = ['work', 'rest', 'eat', 'shop', 'socialize', 'seekJob', 'seekCare', 'protest', 'wait'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isPoint = (v: unknown): boolean => isObj(v) && isInt(v.x) && isInt(v.y);

/** Returns a list of problems; empty means the world is valid. */
export function validateWorld(w: unknown): string[] {
  const errors: string[] = [];
  const err = (m: string) => {
    if (errors.length < 20) errors.push(m);
  };
  if (!isObj(w)) return ['World is not an object'];

  for (const k of ['seed', 'rngState', 'tick', 'width', 'height', 'nextBuildingId', 'nextCitizenId', 'nextEventId']) {
    if (!isInt(w[k])) err(`${k} must be an integer`);
  }
  if (!isNum(w.treasury) || (w.treasury as number) < 0) err('Treasury must be a non-negative number');
  const width = w.width as number;
  const height = w.height as number;
  if (!(width > 0 && height > 0 && width <= 200 && height <= 200)) err('Map dimensions out of range');
  if (!Array.isArray(w.tiles) || w.tiles.length !== width * height || w.tiles.some((t) => t !== 'grass' && t !== 'road')) {
    err('Tile grid is malformed');
  }
  const inMap = (p: unknown) => isPoint(p) && (p as { x: number }).x >= 0 && (p as { y: number }).y >= 0 && (p as { x: number }).x < width && (p as { y: number }).y < height;

  // Policies
  if (!isObj(w.policies)) err('Missing policies');
  else {
    for (const key of Object.keys(POLICY_LIMITS) as (keyof typeof POLICY_LIMITS)[]) {
      const v = w.policies[key];
      if (!isNum(v) || v < POLICY_LIMITS[key].min || v > POLICY_LIMITS[key].max) err(`Policy ${key} out of range`);
    }
    if (typeof w.policies.energyConservation !== 'boolean') err('Policy energyConservation must be boolean');
  }

  // Buildings
  const buildingTypes = new Map<number, BuildingType>();
  const occupied = new Set<number>();
  if (!Array.isArray(w.buildings)) err('Missing buildings');
  else {
    for (const b of w.buildings) {
      if (!isObj(b) || !isInt(b.id)) {
        err('Building without a valid id');
        continue;
      }
      const id = b.id as number;
      if (buildingTypes.has(id)) err(`Duplicate building id ${id}`);
      if (id >= (w.nextBuildingId as number)) err(`Building id ${id} not below nextBuildingId`);
      const type = b.type as BuildingType;
      const d = BUILDING_DEFS[type];
      if (!d) {
        err(`Building ${id} has unknown type`);
        continue;
      }
      buildingTypes.set(id, type);
      if (!isInt(b.x) || !isInt(b.y) || b.w !== d.w || b.h !== d.h) err(`Building ${id} has invalid geometry`);
      else {
        for (let y = b.y as number; y < (b.y as number) + d.h; y++) {
          for (let x = b.x as number; x < (b.x as number) + d.w; x++) {
            if (x < 0 || y < 0 || x >= width || y >= height) err(`Building ${id} is outside the map`);
            const idx = y * width + x;
            if (occupied.has(idx)) err(`Building ${id} overlaps another building`);
            occupied.add(idx);
          }
        }
      }
      if (!isNum(b.funds) || (b.funds as number) < 0) err(`Building ${id} has invalid funds`);
      if (!isNum(b.stock) || (b.stock as number) < 0) err(`Building ${id} has invalid stock`);
      if (b.status !== 'operational' && b.status !== 'closed') err(`Building ${id} has invalid status`);
      if (!isInt(b.distressHours) || !isInt(b.unpaidUpkeepHours)) err(`Building ${id} has invalid counters`);
      if (!isObj(b.today) || !isObj(b.yesterday)) err(`Building ${id} is missing daily stats`);
    }
    if (!(w.buildings as unknown[]).some((b) => isObj(b) && b.type === 'cityHall')) err('City Hall is missing');
  }

  // Citizens
  const citizenIds = new Set<number>();
  const homeCounts = new Map<number, number>();
  const jobCounts = new Map<number, number>();
  if (!Array.isArray(w.citizens)) err('Missing citizens');
  else {
    for (const c of w.citizens) {
      if (!isObj(c) || !isInt(c.id)) {
        err('Citizen without a valid id');
        continue;
      }
      const id = c.id as number;
      if (citizenIds.has(id)) err(`Duplicate citizen id ${id}`);
      citizenIds.add(id);
      if (id >= (w.nextCitizenId as number)) err(`Citizen id ${id} not below nextCitizenId`);
      if (typeof c.name !== 'string' || c.name.length === 0) err(`Citizen ${id} has no name`);
      if (!isNum(c.money) || (c.money as number) < 0) err(`Citizen ${id} has invalid money`);
      if (!isNum(c.wage) || (c.wage as number) < 0) err(`Citizen ${id} has invalid wage`);
      if (!isInt(c.food) || (c.food as number) < 0) err(`Citizen ${id} has invalid food`);
      for (const group of ['needs', 'traits', 'skills'] as const) {
        const g = c[group];
        if (!isObj(g)) {
          err(`Citizen ${id} is missing ${group}`);
          continue;
        }
        const max = group === 'needs' ? 100 : 1;
        for (const [k, v] of Object.entries(g)) if (!isNum(v) || v < 0 || v > max) err(`Citizen ${id} ${group}.${k} out of range`);
      }
      if (!inMap(c.pos) || !inMap(c.prevPos)) err(`Citizen ${id} position is off the map`);
      if (c.homeId !== null) {
        const t = buildingTypes.get(c.homeId as number);
        if (!t || BUILDING_DEFS[t].housing === 0) err(`Citizen ${id} home does not exist`);
        else homeCounts.set(c.homeId as number, (homeCounts.get(c.homeId as number) ?? 0) + 1);
      }
      if (c.jobId !== null) {
        const t = buildingTypes.get(c.jobId as number);
        if (!t || BUILDING_DEFS[t].jobs === 0) err(`Citizen ${id} workplace does not exist`);
        else jobCounts.set(c.jobId as number, (jobCounts.get(c.jobId as number) ?? 0) + 1);
      }
      const a = c.activity;
      if (!isObj(a)) err(`Citizen ${id} has no activity`);
      else if (a.kind === 'idle') {
        if (!isInt(a.wait) || (a.wait as number) < 0) err(`Citizen ${id} idle wait invalid`);
      } else if (a.kind === 'traveling' || a.kind === 'performing') {
        if (!ACTIONS.includes(a.action as ActionKind)) err(`Citizen ${id} has unknown action`);
        if (a.targetId !== null && !buildingTypes.has(a.targetId as number)) err(`Citizen ${id} activity targets a missing building`);
        if (a.kind === 'traveling' && (!Array.isArray(a.path) || !a.path.every(inMap) || !inMap(a.destination))) err(`Citizen ${id} path invalid`);
        if (a.kind === 'performing' && (!isInt(a.elapsed) || !isInt(a.maxTicks))) err(`Citizen ${id} activity timer invalid`);
      } else err(`Citizen ${id} activity kind invalid`);
      if (!Array.isArray(c.goals) || !Array.isArray(c.memories) || !isObj(c.relationships)) err(`Citizen ${id} is missing goals, memories or relationships`);
      if (!isObj(c.complaintCooldowns)) err(`Citizen ${id} is missing complaint cooldowns`);
    }
  }
  for (const [id, n] of homeCounts) if (n > BUILDING_DEFS[buildingTypes.get(id)!].housing) err(`Building ${id} has more residents than capacity`);
  for (const [id, n] of jobCounts) if (n > BUILDING_DEFS[buildingTypes.get(id)!].jobs) err(`Building ${id} has more employees than jobs`);

  if (!isObj(w.power)) err('Missing power state');
  if (!Array.isArray(w.events)) err('Missing event log');
  if (!isObj(w.eventState) || !isObj(w.eventState.flags) || !isObj(w.eventState.streaks) || !isObj(w.eventState.lastFired)) err('Missing event state');
  if (!isObj(w.ledger) || !isObj(w.ledger.today) || !isObj(w.ledger.yesterday) || !isNum(w.ledger.external)) err('Missing ledger');
  if (!Array.isArray(w.history) || !Array.isArray(w.dailyUnemployment)) err('Missing statistics history');

  if (w.difficulty !== 'relaxed' && w.difficulty !== 'standard' && w.difficulty !== 'hard') err('Unknown difficulty');
  const wx = w.weather;
  if (!isObj(wx) || !WEATHER_KINDS.includes(wx.kind as string) || !WEATHER_KINDS.includes(wx.forecast as string) || !isInt(wx.untilTick)) err('Weather state invalid');
  const ap = w.approval;
  if (!isObj(ap) || !isNum(ap.value) || (ap.value as number) < 0 || (ap.value as number) > 100 || !Array.isArray(ap.factors) || !Array.isArray(ap.modifiers)) err('Approval state invalid');
  else if (!(ap.modifiers as unknown[]).every((m) => isObj(m) && typeof m.label === 'string' && isNum(m.value) && isInt(m.untilTick))) err('Approval modifier invalid');
  const el = w.election;
  if (!isObj(el) || !isInt(el.nextTick) || !isInt(el.term) || (el.term as number) < 1 || !Array.isArray(el.history)) err('Election state invalid');
  if (!isObj(w.milestones) || !Object.values(w.milestones).every(isInt)) err('Milestones invalid');
  if (!isInt(w.nextPetitionId)) err('nextPetitionId must be an integer');
  if (!Array.isArray(w.petitions)) err('Missing petitions');
  else {
    const ids = new Set<number>();
    for (const p of w.petitions) {
      if (!isObj(p) || !isInt(p.id) || !Array.isArray(p.options) || !isInt(p.expiresAt)) {
        err('Petition malformed');
        continue;
      }
      if (ids.has(p.id as number)) err(`Duplicate petition id ${p.id}`);
      ids.add(p.id as number);
      if ((p.id as number) >= (w.nextPetitionId as number)) err(`Petition id ${p.id} not below nextPetitionId`);
      const opts = p.options as unknown[];
      if (!opts.every((o) => isObj(o) && typeof o.id === 'string' && isNum(o.cost) && (o.cost as number) >= 0)) err(`Petition ${p.id} has invalid options`);
      if (!opts.some((o) => isObj(o) && o.id === p.defaultOption)) err(`Petition ${p.id} default option missing`);
      if (p.buildingId !== null && !buildingTypes.has(p.buildingId as number)) err(`Petition ${p.id} refers to a missing building`);
    }
  }
  if (!Array.isArray(w.effects) || !(w.effects as unknown[]).every((e) => isObj(e) && EFFECT_KINDS.includes(e.kind as string) && isInt(e.startTick) && isInt(e.untilTick) && isNum(e.value))) err('Effects invalid');
  if (!Array.isArray(w.bulletins)) err('Missing bulletins');
  if (w.gameOver !== null && !(isObj(w.gameOver) && isInt(w.gameOver.tick) && typeof w.gameOver.reason === 'string')) err('Game-over state invalid');
  if (typeof w.sandbox !== 'boolean') err('Sandbox flag must be boolean');
  return errors;
}

export function parseSave(text: string | null | undefined): LoadResult {
  if (text === null || text === undefined || text === '') return { ok: false, error: 'No saved game found' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Save data is corrupted (not valid JSON)' };
  }
  if (!isObj(raw) || raw.format !== SAVE_FORMAT) return { ok: false, error: 'Not an AI City save file' };
  if (!isInt(raw.version) || (raw.version as number) < 1) return { ok: false, error: 'Save file has no valid version' };
  let version = raw.version as number;
  if (version > SAVE_VERSION) return { ok: false, error: `Save was made by a newer version (v${version}); this build supports v${SAVE_VERSION}` };
  let file = raw;
  while (version < SAVE_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) return { ok: false, error: `No migration from save version ${version}` };
    file = migrate(file);
    version += 1;
  }
  const errors = validateWorld(file.world);
  if (errors.length > 0) return { ok: false, error: `Save data is invalid: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? ` (+${errors.length - 3} more)` : ''}` };
  const world = file.world as World;
  // Derived data is recomputed rather than trusted.
  refreshEntrances(world);
  if (raw.version === 1) {
    world.approval.factors = approvalFactors(world);
    world.approval.value = Math.round(targetApproval(world.approval.factors) * 10) / 10;
  }
  return { ok: true, world, savedAt: typeof file.savedAt === 'string' ? file.savedAt : '' };
}

/** Minimal storage interface so persistence can be tested without a browser. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const SAVE_KEY = 'ai-city:save:slot1';

export function saveToStorage(storage: KeyValueStorage, world: World, savedAt: string, key = SAVE_KEY): { ok: true } | { ok: false; error: string } {
  try {
    storage.setItem(key, serializeWorld(world, savedAt));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Could not write save: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export function loadFromStorage(storage: KeyValueStorage, key = SAVE_KEY): LoadResult {
  let text: string | null;
  try {
    text = storage.getItem(key);
  } catch (e) {
    return { ok: false, error: `Could not read save: ${e instanceof Error ? e.message : String(e)}` };
  }
  return parseSave(text);
}
