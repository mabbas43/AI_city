import { describe, expect, it } from 'vitest';
import { stepWorld } from '../src/sim';
import { chooseAction, generateCandidates } from '../src/sim/decision';
import { distanceField } from '../src/sim/navigation';
import { decayNeeds, happinessFactors, targetHappiness } from '../src/sim/needs';
import { NEEDS } from '../src/sim/constants';
import { atHour, byType, prime, world } from './helpers';

describe('citizen needs', () => {
  it('awake citizens lose energy and get hungrier each tick', () => {
    const w = world();
    const c = prime(w.citizens[0], { energy: 50, hunger: 30 });
    decayNeeds(c);
    expect(c.needs.energy).toBeCloseTo(50 - NEEDS.energyDecay);
    expect(c.needs.hunger).toBeCloseTo(30 + NEEDS.hungerGrowth);
  });

  it('starvation erodes health; being fed and rested heals slowly', () => {
    const w = world();
    const starving = prime(w.citizens[0], { hunger: 95, energy: 50, health: 80 });
    decayNeeds(starving);
    expect(starving.needs.health).toBeCloseTo(80 - NEEDS.starvationHealthLoss);
    const fine = prime(w.citizens[1], { hunger: 20, energy: 70, health: 80 });
    decayNeeds(fine);
    expect(fine.needs.health).toBeCloseTo(80 + NEEDS.naturalHealing);
  });

  it('needs stay within 0..100', () => {
    const w = world();
    const c = prime(w.citizens[0], { energy: 0.01, hunger: 99.99 });
    for (let i = 0; i < 50; i++) decayNeeds(c);
    expect(c.needs.energy).toBe(0);
    expect(c.needs.hunger).toBe(100);
    expect(c.needs.health).toBeGreaterThanOrEqual(0);
  });

  it('resting at a powered home restores energy', () => {
    const w = world();
    atHour(w, 23);
    const c = prime(w.citizens[0], { energy: 20, hunger: 10 });
    const home = w.buildings.find((b) => b.id === c.homeId)!;
    c.pos = { ...home.entrance };
    stepWorld(w); // decides to rest at home and starts immediately
    expect(c.activity.kind).toBe('performing');
    const e0 = c.needs.energy;
    for (let i = 0; i < 12; i++) stepWorld(w);
    expect(c.needs.energy).toBeGreaterThan(e0 + 12 * (NEEDS.restHome - 0.01) - 1);
  });

  it('homelessness and unemployment lower target happiness', () => {
    const w = world();
    const c = w.citizens.find((x) => x.jobId !== null)!;
    const base = targetHappiness(happinessFactors(w, c));
    const job = c.jobId;
    c.jobId = null;
    const unemployed = targetHappiness(happinessFactors(w, c));
    c.homeId = null;
    const homeless = targetHappiness(happinessFactors(w, c));
    expect(unemployed).toBeLessThan(base);
    expect(homeless).toBeLessThan(unemployed - 10);
    expect(happinessFactors(w, c).map((f) => f.label)).toEqual(expect.arrayContaining(['Unemployed', 'Homeless']));
    c.jobId = job;
  });
});

describe('utility-based action selection', () => {
  it('a starving citizen with groceries at home eats', () => {
    const w = world();
    atHour(w, 13);
    const c = prime(w.citizens[0], { hunger: 85 });
    c.food = 2;
    const choice = chooseAction(w, c, distanceField(w, c.pos));
    expect(choice.action).toBe('eat');
    expect(c.lastDecision?.reasons.join(' ')).toContain('Hunger 85');
  });

  it('a hungry citizen with no food and no money cannot buy a meal', () => {
    const w = world();
    atHour(w, 13);
    const c = prime(w.citizens[0], { hunger: 85 });
    c.food = 0;
    c.money = 0;
    const choice = chooseAction(w, c, distanceField(w, c.pos));
    expect(choice.action).not.toBe('eat');
  });

  it('an exhausted citizen at night goes home to rest', () => {
    const w = world();
    atHour(w, 23);
    const c = prime(w.citizens[0], { energy: 15 });
    const choice = chooseAction(w, c, distanceField(w, c.pos));
    expect(choice.action).toBe('rest');
    expect(choice.target?.id).toBe(c.homeId);
  });

  it('an employed, rested citizen works during work hours', () => {
    const w = world();
    atHour(w, 10);
    const c = prime(w.citizens.find((x) => x.jobId !== null)!);
    const choice = chooseAction(w, c, distanceField(w, c.pos));
    expect(choice.action).toBe('work');
    expect(choice.target?.id).toBe(c.jobId);
  });

  it('nobody chooses to work outside work hours', () => {
    const w = world();
    atHour(w, 2);
    for (const c of w.citizens) {
      prime(c);
      expect(chooseAction(w, c, distanceField(w, c.pos)).action).not.toBe('work');
    }
  });

  it('an unemployed citizen seeks a job in the daytime', () => {
    const w = world();
    atHour(w, 9);
    const c = prime(w.citizens.find((x) => x.jobId === null)!);
    const choice = chooseAction(w, c, distanceField(w, c.pos));
    expect(choice.action).toBe('seekJob');
    expect(choice.target?.type).toBe('cityHall');
  });

  it('personality matters: sociable citizens value socializing more than loners', () => {
    const w = world();
    atHour(w, 19);
    const c = prime(w.citizens[0]);
    c.socialBuff = 0;
    const best = () => Math.max(...generateCandidates(w, c, distanceField(w, c.pos)).filter((x) => x.action === 'socialize').map((x) => x.score));
    c.traits.sociability = 1;
    const sociable = best();
    c.traits.sociability = 0;
    const loner = best();
    expect(sociable - loner).toBeGreaterThan(0.4);
    c.traits.sociability = 1;
    expect(chooseAction(w, c, distanceField(w, c.pos)).action).toBe('socialize');
  });

  it('a closed workplace is not chosen for work', () => {
    const w = world();
    atHour(w, 10);
    const c = prime(w.citizens.find((x) => x.jobId !== null)!);
    w.buildings.find((b) => b.id === c.jobId)!.status = 'closed';
    expect(chooseAction(w, c, distanceField(w, c.pos)).action).not.toBe('work');
  });

  it('decisions record alternatives with lower scores', () => {
    const w = world();
    atHour(w, 10);
    const c = prime(w.citizens[0], { hunger: 50, energy: 50 });
    chooseAction(w, c, distanceField(w, c.pos));
    const d = c.lastDecision!;
    expect(d.alternatives.length).toBeGreaterThan(0);
    for (const a of d.alternatives) expect(a.score).toBeLessThanOrEqual(d.score);
  });

  it('a sick citizen goes to a staffed clinic', () => {
    const w = world();
    atHour(w, 11);
    const c = prime(w.citizens[0], { health: 20 });
    const choice = chooseAction(w, c, distanceField(w, c.pos));
    expect(choice.action).toBe('seekCare');
    expect(choice.target?.id).toBe(byType(w, 'clinic').id);
  });
});
