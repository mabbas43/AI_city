import { describe, expect, it } from 'vitest';
import { bulldoze, placeBuilding, stepTicks, stepWorld, TICKS_PER_DAY } from '../src/sim';
import { findPath, distanceField, travelTime } from '../src/sim/navigation';
import { GUARDS } from '../src/sim/constants';
import { createBuilding } from '../src/sim/construction';
import { buildingAt, inBounds, refreshEntrances } from '../src/sim/map';
import type { World } from '../src/sim';

/** Place a 2x2 house ignoring road rules, but only on free, in-bounds tiles. */
function wall(w: World, x: number, y: number): boolean {
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) if (!inBounds(w, x + i, y + j) || buildingAt(w, x + i, y + j)) return false;
  createBuilding(w, 'house', x, y);
  refreshEntrances(w);
  return true;
}
import { emptyWorld, layRoad } from '../src/sim/world';
import { atHour, byType, prime, world } from './helpers';

describe('navigation', () => {
  it('prefers roads over open ground', () => {
    const w = emptyWorld(1, 10, 5);
    layRoad(w, 0, 0, 9, 0);
    // Straight across grass row 2 is 9 tiles * 3 ticks; via road it is faster.
    const field = distanceField(w, { x: 0, y: 2 });
    expect(travelTime(field, { x: 9, y: 2 })).toBeLessThan(27);
    const path = findPath(w, { x: 0, y: 2 }, { x: 9, y: 2 })!;
    expect(path.some((p) => p.y === 0)).toBe(true);
    expect(path.at(-1)).toEqual({ x: 9, y: 2 });
  });

  it('buildings block movement and enclosed tiles are unreachable', () => {
    const w = emptyWorld(1, 9, 9);
    // A ring of 2x2 houses fully encloses the inner 2x2 area.
    for (const [x, y] of [[2, 2], [4, 2], [6, 2], [2, 4], [6, 4], [2, 6], [4, 6], [6, 6]]) createBuilding(w, 'house', x, y);
    // (4,4)-(5,5) inner area is surrounded.
    expect(findPath(w, { x: 0, y: 0 }, { x: 4, y: 4 })).toBeNull();
    expect(findPath(w, { x: 0, y: 0 }, { x: 8, y: 8 })).not.toBeNull();
  });
});

describe('citizens never get permanently stuck', () => {
  it('a citizen re-routes when a building is placed on its path', () => {
    const w = world();
    atHour(w, 9);
    const c = prime(w.citizens.find((x) => x.jobId === null)!);
    stepWorld(w);
    expect(c.activity.kind).toBe('traveling');
    if (c.activity.kind !== 'traveling') return;
    // Drop a building directly onto the route, a few steps ahead.
    const ahead = c.activity.path[Math.min(3, c.activity.path.length - 1)];
    wall(w, ahead.x, ahead.y) || wall(w, ahead.x - 1, ahead.y - 1);
    stepTicks(w, GUARDS.maxTravelTicks + 10);
    expect(c.activity.kind === 'traveling' && c.activity.ticksTraveled > GUARDS.maxTravelTicks).toBe(false);
  });

  it('demolishing the road network does not trap anyone: they walk on open ground', () => {
    const w = world(9);
    for (let i = 0; i < w.tiles.length; i++) if (w.tiles[i] === 'road') bulldoze(w, i % w.width, Math.floor(i / w.width));
    expect(w.tiles.includes('road')).toBe(false);
    const original = w.citizens.map((c) => c.id);
    const actions = new Set<string>();
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      stepWorld(w);
      for (const c of w.citizens) if (c.activity.kind === 'performing') actions.add(`${c.id}:${c.activity.action}`);
    }
    // Every citizen still completed trips and performed real activities.
    for (const id of original) expect([...actions].some((a) => a.startsWith(`${id}:`) && !a.endsWith(':wait'))).toBe(true);
  });

  it('a citizen whose home becomes unreachable still finds other things to do', () => {
    const w = world(12);
    const home = byType(w, 'house');
    w.treasury = 1e6;
    const residents = w.citizens.filter((c) => c.homeId === home.id);
    // Wall the house in with buildings on every free side.
    for (const [x, y] of [[home.x - 2, home.y], [home.x + 2, home.y], [home.x, home.y - 2], [home.x, home.y + 2], [home.x - 1, home.y - 2], [home.x + 1, home.y + 2]]) wall(w, x, y);
    stepTicks(w, TICKS_PER_DAY);
    for (const c of residents) {
      expect(c.activity.kind === 'traveling' && c.activity.ticksTraveled > GUARDS.maxTravelTicks).toBe(false);
    }
  });

  it('citizens on a tile that gets built over are moved to the building entrance', () => {
    const w = world();
    const c = w.citizens[0];
    c.activity = { kind: 'idle', wait: 50 };
    c.pos = { x: 5, y: 14 };
    expect(placeBuilding(w, 'house', 4, 13).ok).toBe(true);
    const b = w.buildings.at(-1)!;
    expect(c.pos).toEqual(b.entrance);
  });
});
