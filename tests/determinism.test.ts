import { describe, expect, it } from 'vitest';
import { createWorld, stepTicks, TICKS_PER_DAY } from '../src/sim';
import { random } from '../src/sim/rng';

describe('determinism', () => {
  it('the same seed produces an identical world after two simulated days', () => {
    const a = createWorld({ seed: 2024 });
    const b = createWorld({ seed: 2024 });
    stepTicks(a, TICKS_PER_DAY * 2);
    stepTicks(b, TICKS_PER_DAY * 2);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('different seeds produce different citizens and histories', () => {
    const a = createWorld({ seed: 1 });
    const b = createWorld({ seed: 2 });
    expect(a.citizens.map((c) => c.name)).not.toEqual(b.citizens.map((c) => c.name));
    stepTicks(a, 200);
    stepTicks(b, 200);
    expect(JSON.stringify(a.citizens)).not.toBe(JSON.stringify(b.citizens));
  });

  it('the RNG sequence is reproducible from stored state', () => {
    const w = createWorld({ seed: 99 });
    const state = w.rngState;
    const first = [random(w), random(w), random(w)];
    w.rngState = state;
    expect([random(w), random(w), random(w)]).toEqual(first);
    for (const v of first) expect(v >= 0 && v < 1).toBe(true);
  });

  it('starts with 20 citizens with unique ids', () => {
    const w = createWorld({ seed: 5 });
    expect(w.citizens).toHaveLength(20);
    expect(new Set(w.citizens.map((c) => c.id)).size).toBe(20);
  });
});
