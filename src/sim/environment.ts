// Neighbourhood quality: industrial pollution, nearby services and commutes.
// All values are derived from the current buildings, so they need no storage.

import { buildingCenter, employeesOf, getBuilding } from './buildings';
import { manhattan } from './map';
import type { Building, Citizen, World } from './types';

/** Pollution strength and reach (tiles) of each polluting building. */
const POLLUTERS: Partial<Record<Building['type'], { strength: number; radius: number }>> = {
  factory: { strength: 1, radius: 7 },
  powerStation: { strength: 0.5, radius: 5 },
};
const PARK_CLEANING = { strength: 0.3, radius: 5 };

export const SERVICE_RADIUS = { park: 10, clinic: 18, school: 12 };
export const LONG_COMMUTE = 24;

function falloff(dx: number, dy: number, radius: number): number {
  return Math.max(0, 1 - Math.hypot(dx, dy) / radius);
}

/** A polluter only emits while it is running with staff. */
function emitting(world: World, b: Building): boolean {
  if (b.status !== 'operational') return false;
  if (b.type === 'factory') return b.powered && employeesOf(world, b.id).length > 0;
  return true;
}

/** Air pollution at a point (tile coordinates), 0 (clean) .. 1 (heavy). */
export function pollutionAt(world: World, x: number, y: number): number {
  let p = 0;
  let cleaning = 0;
  for (const b of world.buildings) {
    const c = buildingCenter(b);
    if (b.type === 'park' && b.status === 'operational') cleaning += PARK_CLEANING.strength * falloff(x - c.x, y - c.y, PARK_CLEANING.radius);
    const src = POLLUTERS[b.type];
    if (src && emitting(world, b)) p += src.strength * falloff(x - c.x, y - c.y, src.radius);
  }
  return Math.max(0, Math.min(1, p - cleaning));
}

export function buildingPollution(world: World, b: Building): number {
  const c = buildingCenter(b);
  return Math.round(pollutionAt(world, c.x, c.y) * 100) / 100;
}

function within(world: World, from: Building, type: Building['type'], radius: number, staffed: boolean): boolean {
  const hc = buildingCenter(from);
  return world.buildings.some((b) => {
    if (b.type !== type || b.status !== 'operational') return false;
    if (staffed && employeesOf(world, b.id).length === 0) return false;
    const c = buildingCenter(b);
    return Math.abs(c.x - hc.x) + Math.abs(c.y - hc.y) <= radius;
  });
}

export interface Neighbourhood {
  pollution: number;
  park: boolean;
  clinic: boolean;
  school: boolean;
}

export function neighbourhood(world: World, home: Building): Neighbourhood {
  return {
    pollution: buildingPollution(world, home),
    park: within(world, home, 'park', SERVICE_RADIUS.park, false),
    clinic: within(world, home, 'clinic', SERVICE_RADIUS.clinic, true),
    school: within(world, home, 'school', SERVICE_RADIUS.school, true),
  };
}

/** Number of services (park, clinic, school) covering a tile, for the map overlay. */
export function serviceCoverageAt(world: World, x: number, y: number): number {
  let n = 0;
  for (const [type, radius] of Object.entries(SERVICE_RADIUS) as [Building['type'], number][]) {
    const ok = world.buildings.some((b) => {
      if (b.type !== type || b.status !== 'operational') return false;
      const c = buildingCenter(b);
      return Math.abs(c.x - x) + Math.abs(c.y - y) <= radius;
    });
    if (ok) n += 1;
  }
  return n;
}

/** Street distance between home and workplace entrances, in tiles. */
export function commuteDistance(world: World, c: Citizen): number | null {
  const home = getBuilding(world, c.homeId);
  const job = getBuilding(world, c.jobId);
  if (!home || !job) return null;
  return manhattan(home.entrance, job.entrance);
}
