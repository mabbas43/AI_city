// Passive need dynamics and the happiness model.

import { BUILDING_DEFS, getBuilding } from './buildings';
import { clamp, friendCount } from './citizens';
import { NEEDS, TICKS_PER_DAY } from './constants';
import { activeEffect } from './effects';
import { LONG_COMMUTE, commuteDistance, neighbourhood } from './environment';
import { isWeekend } from './time';
import { WEATHER } from './weather';
import type { Citizen, HappinessFactor, World } from './types';

function isDoing(c: Citizen, action: string): boolean {
  return c.activity.kind === 'performing' && c.activity.action === action;
}

/** Per-tick decay of energy, hunger, health and social satisfaction. */
export function decayNeeds(c: Citizen): void {
  const n = c.needs;
  const resting = isDoing(c, 'rest');
  if (!resting) n.energy -= NEEDS.energyDecay;
  if (isDoing(c, 'work')) n.energy -= NEEDS.workEnergyCost;
  n.hunger += resting ? NEEDS.hungerGrowth * 0.5 : NEEDS.hungerGrowth;

  if (n.hunger > 85) n.health -= NEEDS.starvationHealthLoss;
  if (n.energy < 10) n.health -= NEEDS.exhaustionHealthLoss;
  if (n.hunger < 60 && n.energy > 30) n.health += NEEDS.naturalHealing;

  c.socialBuff = Math.max(0, c.socialBuff - NEEDS.socialBuffDecay);
  n.energy = clamp(n.energy, 0, 100);
  n.hunger = clamp(n.hunger, 0, 100);
  n.health = clamp(n.health, 0, 100);
}

/** Itemised contributions to a citizen's target happiness. */
export function happinessFactors(world: World, c: Citizen): HappinessFactor[] {
  const f: HappinessFactor[] = [{ label: 'Baseline', value: 45 }];
  const n = c.needs;
  if (c.jobId !== null) f.push({ label: 'Employed', value: 6 });
  else f.push({ label: 'Unemployed', value: -6 - Math.min(14, (c.ticksUnemployed / TICKS_PER_DAY) * 6) });

  const home = getBuilding(world, c.homeId);
  if (!home) f.push({ label: 'Homeless', value: -20 });
  else if (!home.powered) f.push({ label: 'No power at home', value: -10 });

  if (n.hunger > 60) f.push({ label: 'Hungry', value: -(n.hunger - 60) * 0.5 });
  if (n.energy < 30) f.push({ label: 'Exhausted', value: -(30 - n.energy) * 0.5 });
  if (n.health < 70) f.push({ label: 'Unwell', value: -(70 - n.health) * 0.4 });

  const friends = friendCount(c);
  if (friends > 0) f.push({ label: `${friends} friend${friends > 1 ? 's' : ''}`, value: Math.min(8, friends * 2) });
  if (c.socialBuff > 0.5) f.push({ label: 'Recent socializing', value: Math.min(9, c.socialBuff * 0.6) });

  if (home) {
    const hood = neighbourhood(world, home);
    if (hood.pollution > 0.1) f.push({ label: 'Polluted air', value: -Math.min(14, hood.pollution * 16) });
    if (hood.park) f.push({ label: 'Park nearby', value: 6 });
    if (hood.school) f.push({ label: 'School nearby', value: 3 });
    if (!hood.clinic) f.push({ label: 'No clinic nearby', value: -3 });
  }
  const commute = commuteDistance(world, c);
  if (commute !== null && commute > LONG_COMMUTE) f.push({ label: 'Long commute', value: -Math.min(6, (commute - LONG_COMMUTE) * 0.3) });

  const weather = WEATHER[world.weather.kind];
  const cooled = world.weather.kind === 'heatwave' && activeEffect(world, 'coolingCenters');
  if (weather.mood !== 0 && !cooled) f.push({ label: weather.label, value: weather.mood });
  if (isWeekend(world.tick)) f.push({ label: 'Weekend', value: 3 });
  const festival = activeEffect(world, 'festival');
  if (festival) f.push({ label: festival.label, value: festival.value });

  if (c.money < 25) f.push({ label: 'Nearly broke', value: -8 });
  else if (c.money > 300) f.push({ label: 'Financially secure', value: 4 });
  const rentDue = home ? BUILDING_DEFS[home.type].rentPerDay : 0;
  if (home && c.jobId === null && c.money < rentDue * 2) f.push({ label: 'Worried about rent', value: -5 });
  if (c.unpaidToday > 0) f.push({ label: 'Wages unpaid', value: -10 });

  const tax = world.policies.incomeTaxRate;
  if (tax > 0.15) f.push({ label: 'High taxes', value: -(tax - 0.15) * 80 });
  else if (tax < 0.1) f.push({ label: 'Low taxes', value: (0.1 - tax) * 40 });
  if (world.policies.energyConservation) f.push({ label: 'Energy rationing', value: -3 });

  const softness = 1 - c.traits.resilience * 0.35;
  return f.map((x) => ({ label: x.label, value: Math.round((x.value < 0 ? x.value * softness : x.value) * 10) / 10 }));
}

/**
 * Hourly environmental health effects: polluted air at home slowly harms
 * residents, and a heatwave wears down anyone without cooling.
 */
export function environmentHealth(world: World): void {
  const pollution = new Map<number, number>();
  const heat = world.weather.kind === 'heatwave' && !activeEffect(world, 'coolingCenters');
  for (const c of world.citizens) {
    const home = getBuilding(world, c.homeId);
    if (home) {
      if (!pollution.has(home.id)) pollution.set(home.id, neighbourhood(world, home).pollution);
      const p = pollution.get(home.id)!;
      if (p > 0.1) c.needs.health = clamp(c.needs.health - p * NEEDS.pollutionHealthLoss, 0, 100);
    }
    if (heat) {
      const coolHome = home && home.powered && c.insideId === home.id;
      if (!coolHome) c.needs.health = clamp(c.needs.health - NEEDS.heatHealthLoss, 0, 100);
    }
  }
}

export function targetHappiness(factors: HappinessFactor[]): number {
  return clamp(factors.reduce((s, x) => s + x.value, 0), 0, 100);
}

/** Happiness drifts towards its target rather than jumping. */
export function driftHappiness(c: Citizen): void {
  const target = targetHappiness(c.happinessFactors);
  c.needs.happiness = clamp(c.needs.happiness + (target - c.needs.happiness) * NEEDS.happinessDrift, 0, 100);
}

export function isHomeless(c: Citizen): boolean {
  return c.homeId === null;
}

export function restRate(world: World, c: Citizen): number {
  const home = getBuilding(world, c.homeId);
  if (home && c.activity.kind === 'performing' && c.activity.targetId === home.id) {
    return home.powered ? NEEDS.restHome : NEEDS.restHomeUnpowered;
  }
  return NEEDS.restOutdoors;
}

export const HOUSING_TYPES = (Object.keys(BUILDING_DEFS) as (keyof typeof BUILDING_DEFS)[]).filter((t) => BUILDING_DEFS[t].housing > 0);
