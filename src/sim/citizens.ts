// Citizen creation, memories, goals, relationships, employment and housing.

import { BUILDING_DEFS, getCitizen, openJobs, vacancies } from './buildings';
import { NEEDS, POPULATION } from './constants';
import { roundMoney } from './economy';
import { pick, random, randomInt, randomRange } from './rng';
import type { Building, Citizen, Goal, GoalKind, Point, World } from './types';

const FIRST_NAMES = [
  'Ava', 'Kai', 'Noor', 'Mateo', 'Yuki', 'Leila', 'Arjun', 'Zara', 'Felix', 'Imani', 'Soren', 'Mira',
  'Rafael', 'Hana', 'Elio', 'Priya', 'Omar', 'Lena', 'Tariq', 'Sofia', 'Jun', 'Amara', 'Nico', 'Ines',
  'Bao', 'Freya', 'Kofi', 'Talia', 'Ravi', 'Esme', 'Dario', 'Wren',
];
const LAST_NAMES = [
  'Okafor', 'Lindqvist', 'Nakamura', 'Haddad', 'Moreau', 'Castillo', 'Petrov', 'Mensah', 'Iyer', 'Kowalski',
  'Sato', 'Reyes', 'Novak', 'Bergström', 'Adeyemi', 'Varga', 'Chen', 'Duarte', 'Rahman', 'Ferreira',
];

export const GOAL_LABELS: Record<GoalKind, (g: Goal) => string> = {
  saveMoney: (g) => `Save ${g.target} credits`,
  findJob: () => 'Find steady work',
  makeFriends: (g) => `Make ${g.target} friend${g.target === 1 ? '' : 's'}`,
  stayHealthy: () => 'Stay healthy for two days',
};

export const FRIEND_THRESHOLD = 50;

export function remember(world: World, c: Citizen, text: string, impact: number): void {
  c.memories.push({ tick: world.tick, text, impact });
  if (c.memories.length > POPULATION.maxMemories) c.memories.splice(0, c.memories.length - POPULATION.maxMemories);
  // Significant experiences nudge mood immediately, softened by resilience.
  const scale = impact < 0 ? 1 - c.traits.resilience * 0.5 : 1;
  c.needs.happiness = clamp(c.needs.happiness + impact * scale, 0, 100);
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function friendCount(c: Citizen): number {
  return Object.values(c.relationships).filter((v) => v >= FRIEND_THRESHOLD).length;
}

export function friendsOf(world: World, c: Citizen): Citizen[] {
  return Object.entries(c.relationships)
    .filter(([, v]) => v >= FRIEND_THRESHOLD)
    .map(([id]) => getCitizen(world, Number(id)))
    .filter((x): x is Citizen => !!x);
}

function makeGoal(world: World, c: Citizen, exclude?: GoalKind): Goal {
  const options: GoalKind[] = ['saveMoney', 'makeFriends', 'stayHealthy'];
  if (c.jobId === null) options.push('findJob', 'findJob');
  const kinds = options.filter((k) => k !== exclude && !c.goals.some((g) => g.kind === k && !g.completed));
  const kind = kinds.length > 0 ? pick(world, kinds) : 'saveMoney';
  switch (kind) {
    case 'saveMoney':
      return { kind, target: Math.round((c.money + randomInt(world, 150, 400)) / 50) * 50, progress: 0, completed: false };
    case 'makeFriends':
      return { kind, target: friendCount(c) + randomInt(world, 1, 2), progress: 0, completed: false };
    case 'stayHealthy':
      return { kind, target: 48, progress: 0, completed: false };
    case 'findJob':
      return { kind, target: 1, progress: 0, completed: false };
  }
}

/** Refresh goal progress hourly; completed goals reward happiness and spawn new ones. */
export function updateGoals(world: World, c: Citizen): void {
  for (const g of c.goals) {
    if (g.completed) continue;
    switch (g.kind) {
      case 'saveMoney':
        g.progress = Math.min(g.target, Math.floor(c.money));
        break;
      case 'makeFriends':
        g.progress = Math.min(g.target, friendCount(c));
        break;
      case 'stayHealthy':
        g.progress = c.needs.health >= 70 ? g.progress + 1 : 0;
        break;
      case 'findJob':
        g.progress = c.jobId !== null ? 1 : 0;
        break;
    }
    if (g.progress >= g.target) {
      g.completed = true;
      remember(world, c, `Achieved a goal: ${GOAL_LABELS[g.kind](g)}`, 12);
    }
  }
  const completed = c.goals.filter((g) => g.completed);
  if (completed.length > 0) {
    c.goals = c.goals.filter((g) => !g.completed);
    for (const g of completed) c.goals.push(makeGoal(world, c, g.kind));
  }
}

export function hasGoal(c: Citizen, kind: GoalKind): boolean {
  return c.goals.some((g) => g.kind === kind && !g.completed);
}

export function occupationFor(b: Building | undefined): string {
  return b ? BUILDING_DEFS[b.type].jobTitle : 'Unemployed';
}

export function wageFor(c: Citizen, b: Building): number {
  const d = BUILDING_DEFS[b.type];
  const skill = d.jobSkill ? c.skills[d.jobSkill] : 0.5;
  return roundMoney(d.baseWage * (0.8 + 0.4 * skill));
}

/** Best open job for a citizen: prefers jobs matching their strongest skills. */
export function bestOpenJob(world: World, c: Citizen): Building | undefined {
  let best: Building | undefined;
  let bestScore = -Infinity;
  for (const b of world.buildings) {
    if (openJobs(world, b) <= 0) continue;
    const d = BUILDING_DEFS[b.type];
    const skill = d.jobSkill ? c.skills[d.jobSkill] : 0.5;
    const score = skill * 2 + d.baseWage;
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  return best;
}

export function hire(world: World, c: Citizen, b: Building): boolean {
  if (c.jobId !== null || openJobs(world, b) <= 0) return false;
  c.jobId = b.id;
  c.occupation = occupationFor(b);
  c.wage = wageFor(c, b);
  c.ticksUnemployed = 0;
  remember(world, c, `Hired as ${c.occupation} at ${BUILDING_DEFS[b.type].label} #${b.id}`, 10);
  return true;
}

export function layOff(world: World, c: Citizen, reason: string): void {
  if (c.jobId === null) return;
  c.jobId = null;
  c.occupation = 'Unemployed';
  c.wage = 0;
  if (!hasGoal(c, 'findJob')) c.goals.push({ kind: 'findJob', target: 1, progress: 0, completed: false });
  remember(world, c, reason, -15);
}

export function findVacantHome(world: World): Building | undefined {
  return world.buildings.find((b) => BUILDING_DEFS[b.type].housing > 0 && b.status === 'operational' && vacancies(world, b) > 0);
}

/** Shift affinity between two citizens symmetrically. */
export function adjustRelationship(world: World, a: Citizen, b: Citizen, delta: number): void {
  if (a.id === b.id) return;
  const before = a.relationships[b.id] ?? 0;
  const after = clamp(before + delta, -100, 100);
  a.relationships[b.id] = Math.round(after * 100) / 100;
  b.relationships[a.id] = clamp((b.relationships[a.id] ?? 0) + delta, -100, 100);
  b.relationships[a.id] = Math.round(b.relationships[a.id] * 100) / 100;
  if (before < FRIEND_THRESHOLD && after >= FRIEND_THRESHOLD) {
    remember(world, a, `Became friends with ${b.name}`, 8);
    remember(world, b, `Became friends with ${a.name}`, 8);
  }
}

/** How well two personalities get along, 0.2..1. */
export function compatibility(a: Citizen, b: Citizen): number {
  const diff =
    Math.abs(a.traits.sociability - b.traits.sociability) +
    Math.abs(a.traits.diligence - b.traits.diligence) +
    Math.abs(a.traits.frugality - b.traits.frugality);
  return Math.max(0.2, 1 - diff / 3);
}

export function createCitizen(world: World, pos: Point, homeId: number | null): Citizen {
  const id = world.nextCitizenId++;
  const name = `${pick(world, FIRST_NAMES)} ${pick(world, LAST_NAMES)}`;
  const r2 = () => Math.round(random(world) * 100) / 100;
  const c: Citizen = {
    id,
    name,
    age: randomInt(world, 19, 64),
    traits: { sociability: r2(), diligence: r2(), frugality: r2(), resilience: r2() },
    skills: { technical: r2(), manual: r2(), social: r2() },
    occupation: 'Unemployed',
    money: roundMoney(randomRange(world, 80, 220)),
    wage: 0,
    needs: {
      energy: Math.round(randomRange(world, 65, 95)),
      hunger: Math.round(randomRange(world, 15, 40)),
      health: Math.round(randomRange(world, 80, 100)),
      happiness: Math.round(randomRange(world, 55, 70)),
    },
    food: randomInt(world, 1, 3),
    homeId,
    jobId: null,
    pos: { ...pos },
    prevPos: { ...pos },
    stepTicks: 1,
    stepElapsed: 1,
    insideId: null,
    activity: { kind: 'idle', wait: randomInt(world, 0, 6) },
    goals: [],
    relationships: {},
    memories: [],
    lastDecision: null,
    happinessFactors: [],
    socialBuff: NEEDS.socialBuffGain * 10,
    workedToday: 0,
    incomeToday: 0,
    unpaidToday: 0,
    ticksUnemployed: 0,
    miseryTicks: 0,
    jobSearchCooldownUntil: 0,
    complaintCooldowns: {},
    arrivedAt: world.tick,
  };
  c.goals.push(makeGoal(world, c));
  return c;
}

/** Remove a citizen and every reference other citizens hold to them. */
export function removeCitizen(world: World, c: Citizen): void {
  world.citizens = world.citizens.filter((x) => x.id !== c.id);
  for (const other of world.citizens) delete other.relationships[c.id];
}

/** Skill gained per daytime hour by residents near a staffed school. */
export const SCHOOL_LEARNING_PER_HOUR = 0.004;

/** Hourly: residents near a working school improve the skill their job uses (or their weakest). */
export function schoolLearning(world: World, nearSchool: (homeId: number) => boolean): void {
  for (const c of world.citizens) {
    if (c.homeId === null || !nearSchool(c.homeId)) continue;
    const skills = c.skills;
    const job = world.buildings.find((b) => b.id === c.jobId);
    const jobSkill = job ? BUILDING_DEFS[job.type].jobSkill : null;
    const weakest = jobSkill ?? (Object.keys(skills) as (keyof typeof skills)[]).reduce((a, b) => (skills[b] < skills[a] ? b : a));
    skills[weakest] = Math.min(1, Math.round((skills[weakest] + SCHOOL_LEARNING_PER_HOUR) * 1000) / 1000);
  }
}

/** Daily: wages follow skills. Returns citizens who earned a raise. */
export function reviewWages(world: World): Citizen[] {
  const raised: Citizen[] = [];
  for (const c of world.citizens) {
    const job = world.buildings.find((b) => b.id === c.jobId);
    if (!job) continue;
    const wage = wageFor(c, job);
    if (wage > c.wage + 0.001) {
      remember(world, c, `Got a raise at ${BUILDING_DEFS[job.type].label} #${job.id} (${c.wage.toFixed(2)} → ${wage.toFixed(2)} cr/tick)`, 4);
      raised.push(c);
    }
    c.wage = Math.max(c.wage, wage);
  }
  return raised;
}
