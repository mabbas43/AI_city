// Power generation and distribution. When demand exceeds supply, buildings
// are served in priority order (civic first, industry last).

import { BUILDING_DEFS, employeesOf } from './buildings';
import { importedPower } from './effects';
import { hourOf } from './time';
import { WEATHER } from './weather';
import type { Building, World } from './types';

/** Hours of unpaid upkeep after which a plant shuts down. */
export const UPKEEP_SHUTDOWN_HOURS = 6;
export const CONSERVATION_FACTOR = 0.8;

export function isDaylight(tick: number): boolean {
  const h = hourOf(tick);
  return h >= 6 && h < 19;
}

export function plantOutput(world: World, b: Building): number {
  const d = BUILDING_DEFS[b.type];
  if (d.powerSupply <= 0 || b.status !== 'operational') return 0;
  if (b.unpaidUpkeepHours >= UPKEEP_SHUTDOWN_HOURS) return 0;
  if (b.type === 'solarArray') return isDaylight(world.tick) ? Math.round(d.powerSupply * WEATHER[world.weather.kind].solar * 10) / 10 : 2;
  // Unstaffed plants run on automation at half output.
  const staffed = employeesOf(world, b.id).length > 0;
  return staffed ? d.powerSupply : d.powerSupply / 2;
}

export function buildingDemand(world: World, b: Building): number {
  const d = BUILDING_DEFS[b.type];
  if (b.status !== 'operational' || d.powerDemand <= 0) return 0;
  // Air conditioning in a heatwave raises demand in homes and businesses, not civic buildings.
  const heat = d.isPublic ? 1 : WEATHER[world.weather.kind].demand;
  return d.powerDemand * heat * (world.policies.energyConservation ? CONSERVATION_FACTOR : 1);
}

export function updatePower(world: World): void {
  let supply = importedPower(world);
  let demand = 0;
  for (const b of world.buildings) {
    supply += plantOutput(world, b);
    demand += buildingDemand(world, b);
  }
  const consumers = world.buildings
    .filter((b) => buildingDemand(world, b) > 0)
    .sort((a, b) => BUILDING_DEFS[a.type].powerPriority - BUILDING_DEFS[b.type].powerPriority || a.id - b.id);
  let remaining = supply;
  const unpowered: number[] = [];
  for (const b of world.buildings) {
    // Generators and zero-demand buildings are always considered powered.
    if (buildingDemand(world, b) === 0) b.powered = b.status === 'operational' || BUILDING_DEFS[b.type].powerDemand === 0;
  }
  for (const b of consumers) {
    const need = buildingDemand(world, b);
    if (need <= remaining + 1e-9) {
      remaining -= need;
      b.powered = true;
    } else {
      b.powered = false;
      b.today.unpoweredTicks += 1;
      unpowered.push(b.id);
    }
  }
  world.power = {
    supply: Math.round(supply * 10) / 10,
    demand: Math.round(demand * 10) / 10,
    shortage: demand > supply + 1e-9,
    unpoweredIds: unpowered,
  };
}
