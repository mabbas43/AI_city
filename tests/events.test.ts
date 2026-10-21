import { describe, expect, it } from 'vitest';
import { stepTicks, stepWorld, TICKS_PER_DAY, TICKS_PER_HOUR, type Citizen } from '../src/sim';
import { detectHourlyEvents } from '../src/sim/events';
import { happinessFactors } from '../src/sim/needs';
import { byType, world } from './helpers';

const CRISES = ['powerShortage', 'protest', 'goodsShortage', 'budgetCrisis', 'housingShortage', 'healthCrisis', 'businessClosure'];

describe('causal events', () => {
  it('a healthy city produces no crisis events in its first day', () => {
    const w = world(21);
    stepTicks(w, TICKS_PER_DAY);
    expect(w.events.filter((e) => CRISES.includes(e.type))).toEqual([]);
  });

  it('every event carries at least one explicit cause', () => {
    const w = world(4);
    w.citizens[0].homeId = null;
    byType(w, 'powerStation').unpaidUpkeepHours = 99;
    stepTicks(w, TICKS_PER_DAY);
    expect(w.events.length).toBeGreaterThan(0);
    for (const e of w.events) expect(e.causes.length).toBeGreaterThan(0);
  });

  it('high unemployment fires once when crossing 20%, not at low unemployment', () => {
    const w = world(1, { employed: 20 });
    detectHourlyEvents(w);
    expect(w.events.some((e) => e.type === 'unemployment')).toBe(false);
    for (const c of w.citizens.slice(0, 6)) c.jobId = null; // 30%
    detectHourlyEvents(w);
    detectHourlyEvents(w);
    const ev = w.events.filter((e) => e.type === 'unemployment');
    expect(ev).toHaveLength(1);
    expect(ev[0].causes[0]).toMatch(/unemployed \(\d+%\)/);
  });

  it('homeless citizens trigger a housing shortage only after two hours', () => {
    const w = world();
    w.citizens[0].homeId = null;
    w.citizens[1].homeId = null;
    detectHourlyEvents(w);
    expect(w.events.some((e) => e.type === 'housingShortage')).toBe(false);
    detectHourlyEvents(w);
    const ev = w.events.find((e) => e.type === 'housingShortage');
    expect(ev?.citizenIds).toEqual(expect.arrayContaining([w.citizens[0].id, w.citizens[1].id]));
  });

  it('a homeless citizen files a complaint, but not twice within a day', () => {
    const w = world();
    const c = w.citizens[0];
    c.homeId = null;
    for (let i = 0; i < 24; i++) {
      w.tick += TICKS_PER_HOUR;
      detectHourlyEvents(w);
    }
    const complaints = w.events.filter((e) => e.type === 'complaint' && e.citizenIds[0] === c.id && e.title.includes('nowhere to live'));
    expect(complaints).toHaveLength(1);
  });

  it('a protest starts only after widespread unhappiness persists for three hours', () => {
    const w = world();
    const setMood = () => {
      for (const c of w.citizens.slice(0, 10)) c.needs.happiness = 10;
    };
    for (let h = 0; h < 2; h++) {
      setMood();
      detectHourlyEvents(w);
    }
    expect(w.eventState.flags.protest).toBeFalsy();
    setMood();
    detectHourlyEvents(w);
    expect(w.eventState.flags.protest).toBe(true);
    const ev = w.events.find((e) => e.type === 'protest');
    expect(ev?.severity).toBe('critical');
    expect(ev?.causes[0]).toMatch(/50% of citizens have happiness below 30/);
  });

  it('unhappy citizens join an active protest at City Hall instead of working', () => {
    const w = world();
    w.eventState.flags.protest = true;
    w.tick = Math.floor(w.tick / TICKS_PER_DAY) * TICKS_PER_DAY + 11 * TICKS_PER_HOUR;
    const c = w.citizens.find((x) => x.jobId !== null)!;
    c.activity = { kind: 'idle', wait: 0 };
    c.needs.happiness = 5;
    c.happinessFactors = happinessFactors(w, c);
    stepWorld(w);
    const a = c.activity as Citizen['activity'];
    expect(a.kind === 'idle' ? null : a.action).toBe('protest');
  });

  it('the protest ends when happiness recovers', () => {
    const w = world();
    w.eventState.flags.protest = true;
    for (const c of w.citizens) c.needs.happiness = 70;
    detectHourlyEvents(w);
    expect(w.eventState.flags.protest).toBe(false);
    expect(w.events.some((e) => e.type === 'protestEnded')).toBe(true);
  });

  it('empty shelves everywhere trigger a goods shortage naming the supply chain state', () => {
    const w = world();
    for (const b of w.buildings) if (b.type === 'shop' || b.type === 'market') b.stock = 0;
    detectHourlyEvents(w);
    const ev = w.events.find((e) => e.type === 'goodsShortage');
    expect(ev?.causes.join(' ')).toMatch(/Factory stock/);
  });

  it('a low treasury triggers a budget crisis', () => {
    const w = world();
    w.treasury = 50;
    detectHourlyEvents(w);
    const ev = w.events.find((e) => e.type === 'budgetCrisis');
    expect(ev?.causes[0]).toMatch(/below one day of public costs/);
  });

  it('immigration happens only when there are vacant homes', () => {
    const full = world(8, { citizens: 26 }); // 26 = total starting housing
    stepTicks(full, TICKS_PER_DAY);
    expect(full.events.some((e) => e.type === 'immigration')).toBe(false);
    const open = world(8);
    stepTicks(open, TICKS_PER_DAY);
    const imm = open.events.filter((e) => e.type === 'immigration');
    expect(imm.length).toBeGreaterThan(0);
    expect(imm[0].causes[0]).toMatch(/vacant homes/);
  });
});
