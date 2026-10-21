// Migration: citizens arrive when the city is attractive and leave after
// sustained misery. Both are driven by explicit, logged conditions.

import { BUILDING_DEFS, buildingLabel } from './buildings';
import { createCitizen, findVacantHome, layOff, removeCitizen, remember } from './citizens';
import { POPULATION, TICKS_PER_HOUR } from './constants';
import { EXTERNAL, citizenAcct, transfer } from './economy';
import { pushEvent } from './events';
import { happinessFactors } from './needs';
import { cityStats } from './stats';
import type { Point, World } from './types';

export const IMMIGRATION_INTERVAL = 6 * TICKS_PER_HOUR;

/** Road tile on the map edge where newcomers arrive. */
export function entryPoint(world: World): Point {
  for (let y = 0; y < world.height; y++) if (world.tiles[y * world.width] === 'road') return { x: 0, y };
  for (let i = 0; i < world.tiles.length; i++) if (world.tiles[i] === 'road') return { x: i % world.width, y: Math.floor(i / world.width) };
  return { x: 0, y: Math.floor(world.height / 2) };
}

export function checkImmigration(world: World): void {
  const s = cityStats(world);
  if (s.vacantHomes <= 0 || s.avgHappiness < POPULATION.immigrationHappiness) return;
  if (s.openJobs <= 0 && s.vacantHomes < 3) return;
  const home = findVacantHome(world);
  if (!home) return;
  const c = createCitizen(world, entryPoint(world), home.id);
  const money = c.money;
  c.money = 0;
  transfer(world, EXTERNAL, citizenAcct(c), money, 'immigration');
  world.citizens.push(c);
  c.happinessFactors = happinessFactors(world, c);
  remember(world, c, `Moved to the city and into ${buildingLabel(home)}`, 5);
  pushEvent(world, {
    type: 'immigration',
    severity: 'info',
    title: `${c.name} moved to the city`,
    description: `A newcomer settled in ${buildingLabel(home)}.`,
    causes: [`${s.vacantHomes} vacant homes`, `Average happiness ${s.avgHappiness.toFixed(0)} (needs ${POPULATION.immigrationHappiness}+)`, `${s.openJobs} open jobs`],
    citizenIds: [c.id],
    buildingIds: [home.id],
  });
}

/** Hourly: citizens miserable for long enough leave, taking their savings. */
export function checkEmigration(world: World): void {
  for (const c of [...world.citizens]) {
    if (c.miseryTicks < POPULATION.emigrationTicks) continue;
    const worst = [...c.happinessFactors].filter((f) => f.value < 0).sort((a, b) => a.value - b.value).slice(0, 3);
    const employer = c.jobId !== null ? world.buildings.find((b) => b.id === c.jobId) : undefined;
    if (employer) layOff(world, c, 'Quit to leave the city');
    if (c.money > 0) transfer(world, citizenAcct(c), EXTERNAL, c.money, 'emigration');
    removeCitizen(world, c);
    pushEvent(world, {
      type: 'emigration',
      severity: 'warning',
      title: `${c.name} left the city`,
      description: `After ${Math.round(c.miseryTicks / TICKS_PER_HOUR)} hours of misery, ${c.name} moved away.`,
      causes: [
        `Happiness below ${POPULATION.emigrationHappiness} for ${Math.round(c.miseryTicks / TICKS_PER_HOUR)} hours`,
        ...worst.map((f) => `${f.label} (${f.value})`),
        ...(employer ? [`${BUILDING_DEFS[employer.type].label} #${employer.id} lost a worker`] : []),
      ],
      citizenIds: [c.id],
    });
  }
}
