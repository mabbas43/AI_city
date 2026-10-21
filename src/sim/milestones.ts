// City milestones: objectives that reward the player with regional grants and
// raise the city's rank, which unlocks new buildings.

import { BUILDING_DEFS } from './buildings';
import { neighbourhood } from './environment';
import { EXTERNAL, TREASURY, transfer } from './economy';
import { pushEvent } from './events';
import { cityStats } from './stats';
import type { World } from './types';

export const RANKS = ['Settlement', 'Town', 'City', 'Metropolis'] as const;

export interface Progress {
  value: number;
  target: number;
}

export interface MilestoneDef {
  id: string;
  title: string;
  description: string;
  reward: number;
  /** Rank granted on completion. */
  rank?: number;
  /** Requirement must hold for this many consecutive hourly checks. */
  hours?: number;
  progress: (world: World) => Progress;
}

const count = (world: World, type: string) => world.buildings.filter((b) => b.type === type).length;
const bool = (ok: boolean): Progress => ({ value: ok ? 1 : 0, target: 1 });

export const BUILDINGS_PLACED = 'buildingsPlaced';
export const SURPLUS_DAYS = 'surplusDays';

export const MILESTONES: MilestoneDef[] = [
  {
    id: 'groundbreaking',
    title: 'Groundbreaking',
    description: 'Construct your first new building.',
    reward: 200,
    progress: (w) => ({ value: Math.min(1, w.eventState.streaks[BUILDINGS_PLACED] ?? 0), target: 1 }),
  },
  {
    id: 'cleanEnergy',
    title: 'Clean Energy',
    description: 'Build a Solar Array.',
    reward: 300,
    progress: (w) => bool(count(w, 'solarArray') > 0),
  },
  {
    id: 'town',
    title: 'Town Charter',
    description: 'Grow to 30 citizens. Unlocks the School.',
    reward: 600,
    rank: 1,
    progress: (w) => ({ value: Math.min(30, w.citizens.length), target: 30 }),
  },
  {
    id: 'fullEmployment',
    title: 'Full Employment',
    description: 'Unemployment below 5% with at least 25 citizens.',
    reward: 400,
    progress: (w) => {
      const s = cityStats(w);
      return bool(s.population >= 25 && s.unemploymentRate < 0.05);
    },
  },
  {
    id: 'thriving',
    title: 'Thriving Community',
    description: 'Keep average happiness at 70 or more for 24 hours.',
    reward: 500,
    hours: 24,
    progress: (w) => bool(cityStats(w).avgHappiness >= 70),
  },
  {
    id: 'balancedBooks',
    title: 'Balanced Books',
    description: 'Finish 3 days in a row with a budget surplus.',
    reward: 500,
    progress: (w) => ({ value: Math.min(3, w.eventState.streaks[SURPLUS_DAYS] ?? 0), target: 3 }),
  },
  {
    id: 'secondTerm',
    title: 'Second Term',
    description: 'Win your first re-election.',
    reward: 300,
    progress: (w) => bool(w.election.term >= 2),
  },
  {
    id: 'education',
    title: 'Knowledge City',
    description: 'Open a School (requires Town rank).',
    reward: 300,
    progress: (w) => bool(count(w, 'school') > 0),
  },
  {
    id: 'city',
    title: 'City Charter',
    description: 'Grow to 50 citizens.',
    reward: 1200,
    rank: 2,
    progress: (w) => ({ value: Math.min(50, w.citizens.length), target: 50 }),
  },
  {
    id: 'greenCity',
    title: 'Green City',
    description: 'Have 3 parks and no home with polluted air.',
    reward: 600,
    progress: (w) => {
      const parks = count(w, 'park');
      const homes = w.buildings.filter((b) => BUILDING_DEFS[b.type].housing > 0);
      const clean = homes.every((h) => neighbourhood(w, h).pollution <= 0.1);
      return { value: Math.min(3, parks) + (clean && parks >= 3 ? 1 : 0), target: 4 };
    },
  },
  {
    id: 'metropolis',
    title: 'Metropolis',
    description: 'Grow to 80 citizens.',
    reward: 2500,
    rank: 3,
    progress: (w) => ({ value: Math.min(80, w.citizens.length), target: 80 }),
  },
];

export function cityRank(world: World): number {
  let rank = 0;
  for (const m of MILESTONES) if (m.rank !== undefined && world.milestones[m.id] !== undefined) rank = Math.max(rank, m.rank);
  return rank;
}

export function rankName(world: World): string {
  return RANKS[cityRank(world)];
}

/** Progress shown to the player, including hours held for sustained milestones. */
export function milestoneProgress(world: World, m: MilestoneDef): Progress {
  if (world.milestones[m.id] !== undefined) {
    const p = m.progress(world);
    return { value: p.target, target: p.target };
  }
  if (m.hours) return { value: Math.min(m.hours, world.eventState.streaks[`milestone:${m.id}`] ?? 0), target: m.hours };
  return m.progress(world);
}

/** Hourly: award newly completed milestones. */
export function checkMilestones(world: World): void {
  for (const m of MILESTONES) {
    if (world.milestones[m.id] !== undefined) continue;
    const p = m.progress(world);
    let done = p.value >= p.target;
    if (m.hours) {
      const key = `milestone:${m.id}`;
      const held = done ? (world.eventState.streaks[key] ?? 0) + 1 : 0;
      world.eventState.streaks[key] = held;
      done = held >= m.hours;
    }
    if (!done) continue;
    const rankBefore = cityRank(world);
    world.milestones[m.id] = world.tick;
    transfer(world, EXTERNAL, TREASURY, m.reward, 'grants');
    const causes = [m.description, `Regional development grant of ${m.reward} cr`];
    const rankAfter = cityRank(world);
    if (rankAfter > rankBefore) {
      causes.push(`City rank raised to ${RANKS[rankAfter]}`);
      const unlocked = Object.values(BUILDING_DEFS).filter((d) => d.unlockRank === rankAfter);
      if (unlocked.length) causes.push(`Unlocked: ${unlocked.map((d) => d.label).join(', ')}`);
    }
    pushEvent(world, {
      type: 'milestone',
      severity: 'info',
      title: `Milestone: ${m.title}`,
      description: rankAfter > rankBefore ? `Your settlement is now a ${RANKS[rankAfter].toLowerCase()}!` : 'The regional government rewarded your progress.',
      causes,
    });
  }
}

/** Label for an unbuildable type, if it is still locked. */
export function lockedReason(world: World, type: keyof typeof BUILDING_DEFS): string | null {
  const need = BUILDING_DEFS[type].unlockRank;
  if (need <= cityRank(world)) return null;
  return `Unlocks at ${RANKS[need]} rank`;
}

