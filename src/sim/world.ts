// Construction of the starting city.

import { BUILDING_DEFS, openJobs } from './buildings';
import { createCitizen, hire } from './citizens';
import { DIFFICULTY, TERM_DAYS, initApproval } from './approval';
import { MAP_HEIGHT, MAP_WIDTH, START_TICK, TICKS_PER_DAY, TICKS_PER_HOUR } from './constants';
import { createBuilding } from './construction';
import { refreshEntrances } from './map';
import { happinessFactors } from './needs';
import { DEFAULT_POLICIES } from './policies';
import { updatePower } from './power';
import { seedToState } from './rng';
import { recordSample } from './stats';
import type { Building, BuildingType, Difficulty, TileKind, World } from './types';

export interface WorldOptions {
  seed?: number;
  citizens?: number;
  /** How many of the starting citizens already have jobs. */
  employed?: number;
  treasury?: number;
  difficulty?: Difficulty;
}

export function emptyWorld(seed: number, width = MAP_WIDTH, height = MAP_HEIGHT): World {
  return {
    seed,
    rngState: seedToState(seed),
    tick: START_TICK,
    width,
    height,
    tiles: new Array<TileKind>(width * height).fill('grass'),
    buildings: [],
    citizens: [],
    nextBuildingId: 1,
    nextCitizenId: 1,
    nextEventId: 1,
    treasury: 6000,
    policies: { ...DEFAULT_POLICIES },
    power: { supply: 0, demand: 0, shortage: false, unpoweredIds: [] },
    events: [],
    eventState: { flags: {}, streaks: {}, lastFired: {} },
    ledger: { today: {}, yesterday: {}, external: 0 },
    history: [],
    dailyUnemployment: [],
    difficulty: 'standard',
    weather: { kind: 'clear', untilTick: START_TICK + 8 * TICKS_PER_HOUR, forecast: 'cloudy' },
    approval: { value: 50, factors: [], modifiers: [] },
    election: { nextTick: TERM_DAYS * TICKS_PER_DAY, term: 1, history: [] },
    milestones: {},
    petitions: [],
    nextPetitionId: 1,
    effects: [],
    bulletins: [],
    gameOver: null,
    sandbox: false,
  };
}

export function layRoad(world: World, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) world.tiles[y * world.width + x] = 'road';
  }
}

const STARTING_LAYOUT: [BuildingType, number, number][] = [
  // West residential district
  ['house', 4, 6],
  ['house', 7, 6],
  ['house', 10, 6],
  ['apartment', 4, 10],
  ['house', 7, 10],
  // Civic centre
  ['park', 14, 6],
  ['cityHall', 17, 9],
  ['clinic', 21, 6],
  // Commercial district
  ['office', 25, 6],
  ['shop', 25, 10],
  ['market', 29, 10],
  // Industry and energy
  ['factory', 25, 13],
  ['powerStation', 31, 13],
];

/**
 * Staff essential services first, then deal workers round-robin across
 * businesses so every workplace starts with some staff. Each slot goes to the
 * best-skilled unemployed candidate.
 */
function staffStartingJobs(world: World, employed: number): void {
  const essentials: BuildingType[] = ['powerStation', 'clinic', 'cityHall'];
  const businesses: BuildingType[] = ['shop', 'market', 'factory', 'office'];
  let hired = 0;
  const hireOne = (b: Building): boolean => {
    if (hired >= employed || openJobs(world, b) <= 0) return false;
    const skill = BUILDING_DEFS[b.type].jobSkill;
    const candidates = world.citizens.filter((c) => c.jobId === null);
    if (candidates.length === 0) return false;
    candidates.sort((a, z) => (skill ? z.skills[skill] - a.skills[skill] : 0) || a.id - z.id);
    hire(world, candidates[0], b);
    hired += 1;
    return true;
  };
  for (const b of world.buildings.filter((x) => essentials.includes(x.type))) hireOne(b);
  const pool = world.buildings.filter((x) => businesses.includes(x.type));
  let progress = true;
  while (progress && hired < employed) {
    progress = false;
    for (const b of pool) if (hireOne(b)) progress = true;
  }
}

export function createWorld(options: WorldOptions = {}): World {
  const seed = options.seed ?? 1337;
  const world = emptyWorld(seed);
  world.difficulty = options.difficulty ?? 'standard';
  world.treasury = options.treasury ?? DIFFICULTY[world.difficulty].treasury;

  layRoad(world, 0, 12, 39, 12); // main avenue, enters from the west edge
  layRoad(world, 3, 5, 36, 5);
  layRoad(world, 3, 19, 36, 19);
  layRoad(world, 3, 5, 3, 19);
  layRoad(world, 13, 0, 13, 25);
  layRoad(world, 24, 5, 24, 19);
  layRoad(world, 36, 5, 36, 19);

  for (const [type, x, y] of STARTING_LAYOUT) createBuilding(world, type, x, y);
  refreshEntrances(world);

  const homes = world.buildings.filter((b) => b.type === 'house' || b.type === 'apartment');
  const count = options.citizens ?? 20;
  const employed = options.employed ?? 14;
  let homeIdx = 0;
  let filled = 0;
  for (let i = 0; i < count; i++) {
    while (homeIdx < homes.length && filled >= (homes[homeIdx].type === 'apartment' ? 10 : 4)) {
      homeIdx += 1;
      filled = 0;
    }
    const home = homes[homeIdx];
    const c = createCitizen(world, home ? home.entrance : { x: 0, y: 12 }, home ? home.id : null);
    c.arrivedAt = 0;
    c.insideId = home ? home.id : null;
    world.citizens.push(c);
    filled += 1;
  }
  staffStartingJobs(world, employed);
  // Starting citizens begin without memories of being hired.
  for (const c of world.citizens) {
    c.memories = [];
    c.needs.happiness = Math.round(55 + c.traits.resilience * 15);
    c.happinessFactors = happinessFactors(world, c);
  }
  updatePower(world);
  // A new mayor enjoys some goodwill while the first jobs get filled.
  world.approval.modifiers.push({ label: 'Honeymoon period', value: 8, untilTick: START_TICK + 48 * TICKS_PER_HOUR });
  initApproval(world);
  recordSample(world);
  return world;
}
