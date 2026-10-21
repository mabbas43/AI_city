import { describe, expect, it } from 'vitest';
import { FixedStepClock } from '../src/sim/clock';
import { createWorld, stepWorld } from '../src/sim';

describe('FixedStepClock', () => {
  it('converts elapsed time into whole ticks and carries the remainder', () => {
    const c = new FixedStepClock({ baseStepMs: 100 });
    expect(c.update(250)).toBe(2);
    expect(c.alpha).toBeCloseTo(0.5);
    expect(c.update(60)).toBe(1); // 50 carried + 60 = 110
    expect(c.update(89)).toBe(0);
  });

  it('is independent of frame rate: same real time gives same tick count', () => {
    const fast = new FixedStepClock({ baseStepMs: 125 });
    const slow = new FixedStepClock({ baseStepMs: 125 });
    let a = 0;
    let b = 0;
    for (let i = 0; i < 625; i++) a += fast.update(8); // 125 fps for 5s
    for (let i = 0; i < 125; i++) b += slow.update(40); // 25 fps for 5s
    expect(a).toBe(40);
    expect(b).toBe(40);
  });

  it('produces no ticks while paused and does not accumulate time', () => {
    const c = new FixedStepClock({ baseStepMs: 100 });
    c.pause();
    expect(c.update(5000)).toBe(0);
    expect(c.alpha).toBe(0);
    c.resume();
    expect(c.update(50)).toBe(0);
    expect(c.update(50)).toBe(1);
  });

  it('scales tick rate with speed', () => {
    const c = new FixedStepClock({ baseStepMs: 100, maxTicksPerUpdate: 100 });
    c.setSpeed(4);
    expect(c.update(1000)).toBe(40);
    const d = new FixedStepClock({ baseStepMs: 100, maxTicksPerUpdate: 100 });
    d.setSpeed(8);
    expect(d.update(1000)).toBe(80);
    expect(() => d.setSpeed(3 as never)).toThrow();
  });

  it('caps ticks per update after a long stall and drops the backlog', () => {
    const c = new FixedStepClock({ baseStepMs: 100, maxTicksPerUpdate: 5 });
    expect(c.update(60_000)).toBe(5);
    expect(c.update(0)).toBe(0);
  });

  it('ignores invalid elapsed values', () => {
    const c = new FixedStepClock({ baseStepMs: 100 });
    expect(c.update(-500)).toBe(0);
    expect(c.update(Number.NaN)).toBe(0);
  });

  it('a paused game does not change the world', () => {
    const w = createWorld({ seed: 3 });
    const before = JSON.stringify(w);
    const c = new FixedStepClock();
    c.pause();
    for (let i = 0; i < c.update(10_000); i++) stepWorld(w);
    expect(JSON.stringify(w)).toBe(before);
  });

  it('each world step advances exactly one tick (5 minutes)', () => {
    const w = createWorld({ seed: 3 });
    const t = w.tick;
    stepWorld(w);
    stepWorld(w);
    expect(w.tick).toBe(t + 2);
  });
});
