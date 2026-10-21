import { createWorld, type BuildingType, type Citizen, type World } from '../src/sim';
import { goIdle } from '../src/sim/activities';

export function world(seed = 7, opts: Parameters<typeof createWorld>[0] = {}): World {
  return createWorld({ seed, ...opts });
}

export function byType(w: World, type: BuildingType) {
  const b = w.buildings.find((x) => x.type === type);
  if (!b) throw new Error(`no ${type}`);
  return b;
}

/** Put a citizen idle at a tile with chosen needs, ready to decide this tick. */
export function prime(c: Citizen, needs: Partial<Citizen['needs']> = {}): Citizen {
  goIdle(c, 0);
  c.needs = { energy: 80, hunger: 20, health: 95, happiness: 60, ...needs };
  c.socialBuff = 15; // already socially satisfied unless a test says otherwise
  return c;
}

export function atHour(w: World, hour: number): void {
  const day = Math.floor(w.tick / 288);
  w.tick = day * 288 + hour * 12;
}
