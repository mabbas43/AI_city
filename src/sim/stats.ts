// Aggregate, read-only statistics derived from world state.

import { BUILDING_DEFS, openJobs, vacancies } from './buildings';
import { POPULATION } from './constants';
import type { StatsSample, World } from './types';

export interface CityStats {
  population: number;
  employed: number;
  unemployed: number;
  unemploymentRate: number;
  openJobs: number;
  totalJobs: number;
  housingCapacity: number;
  vacantHomes: number;
  homeless: number;
  avgHappiness: number;
  avgHealth: number;
  avgEnergy: number;
  avgHunger: number;
  avgMoney: number;
  closedBusinesses: number;
}

export function cityStats(world: World): CityStats {
  const pop = world.citizens.length;
  const employed = world.citizens.filter((c) => c.jobId !== null).length;
  let open = 0;
  let totalJobs = 0;
  let capacity = 0;
  let vacant = 0;
  let closed = 0;
  for (const b of world.buildings) {
    const d = BUILDING_DEFS[b.type];
    if (b.status === 'operational') totalJobs += d.jobs;
    open += openJobs(world, b);
    capacity += d.housing;
    vacant += vacancies(world, b);
    if (b.status === 'closed') closed += 1;
  }
  const avg = (f: (n: (typeof world.citizens)[number]) => number) => (pop ? world.citizens.reduce((s, c) => s + f(c), 0) / pop : 0);
  return {
    population: pop,
    employed,
    unemployed: pop - employed,
    unemploymentRate: pop ? (pop - employed) / pop : 0,
    openJobs: open,
    totalJobs,
    housingCapacity: capacity,
    vacantHomes: vacant,
    homeless: world.citizens.filter((c) => c.homeId === null).length,
    avgHappiness: avg((c) => c.needs.happiness),
    avgHealth: avg((c) => c.needs.health),
    avgEnergy: avg((c) => c.needs.energy),
    avgHunger: avg((c) => c.needs.hunger),
    avgMoney: avg((c) => c.money),
    closedBusinesses: closed,
  };
}

export function recordSample(world: World): void {
  const s = cityStats(world);
  const sample: StatsSample = {
    tick: world.tick,
    population: s.population,
    employed: s.employed,
    unemployed: s.unemployed,
    avgHappiness: Math.round(s.avgHappiness * 10) / 10,
    avgHealth: Math.round(s.avgHealth * 10) / 10,
    treasury: Math.round(world.treasury),
    powerSupply: world.power.supply,
    powerDemand: world.power.demand,
    homeless: s.homeless,
  };
  world.history.push(sample);
  if (world.history.length > POPULATION.maxHistory) world.history.splice(0, world.history.length - POPULATION.maxHistory);
}

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
