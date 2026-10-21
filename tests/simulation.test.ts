import { describe, expect, it } from 'vitest';
import { BUILDING_DEFS, TICKS_PER_DAY, cityStats, placeBuilding, stepWorld } from '../src/sim';
import { GUARDS } from '../src/sim/constants';
import { world } from './helpers';

describe('long-running simulation invariants', () => {
  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}: 5 days with construction keep all invariants`, () => {
      const w = world(seed);
      const longestIdle = new Map<number, number>();
      for (let t = 0; t < TICKS_PER_DAY * 5; t++) {
        if (t === TICKS_PER_DAY) {
          placeBuilding(w, 'apartment', 4, 13);
          placeBuilding(w, 'office', 8, 13);
        }
        stepWorld(w);
        expect(w.treasury).toBeGreaterThanOrEqual(0);
        for (const c of w.citizens) {
          const idleish = c.activity.kind === 'idle' || (c.activity.kind === 'performing' && c.activity.action === 'wait');
          longestIdle.set(c.id, idleish ? (longestIdle.get(c.id) ?? 0) + 1 : 0);
          expect(longestIdle.get(c.id)!).toBeLessThan(12 * 12);
          if (c.activity.kind === 'traveling') expect(c.activity.ticksTraveled).toBeLessThanOrEqual(GUARDS.maxTravelTicks + 1);
        }
      }
      expect(new Set(w.citizens.map((c) => c.id)).size).toBe(w.citizens.length);
      expect(new Set(w.buildings.map((b) => b.id)).size).toBe(w.buildings.length);
      for (const b of w.buildings) {
        const d = BUILDING_DEFS[b.type];
        expect(w.citizens.filter((c) => c.jobId === b.id).length).toBeLessThanOrEqual(d.jobs);
        expect(w.citizens.filter((c) => c.homeId === b.id).length).toBeLessThanOrEqual(d.housing);
        expect(b.funds).toBeGreaterThanOrEqual(0);
        expect(b.stock).toBeGreaterThanOrEqual(0);
      }
      for (const c of w.citizens) {
        expect(c.money).toBeGreaterThanOrEqual(0);
        for (const v of Object.values(c.needs)) expect(v >= 0 && v <= 100).toBe(true);
      }
      const s = cityStats(w);
      expect(s.population).toBeGreaterThanOrEqual(20);
      expect(s.avgHealth).toBeGreaterThan(50);
    });
  }

  it('citizens live varied days: work, rest, eat and socialize all happen', () => {
    const w = world(5);
    const seen = new Set<string>();
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      stepWorld(w);
      for (const c of w.citizens) if (c.activity.kind === 'performing') seen.add(c.activity.action);
    }
    for (const a of ['work', 'rest', 'eat', 'shop', 'socialize']) expect(seen.has(a)).toBe(true);
  });
});
