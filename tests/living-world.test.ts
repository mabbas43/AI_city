import { describe, expect, it } from 'vitest';
import { TICKS_PER_DAY, TICKS_PER_HOUR, placeBuilding, stepTicks, totalMoney } from '../src/sim';
import { approvalFactors, checkElection, electionGrant, targetApproval, updateApproval } from '../src/sim/approval';
import { makeBulletin } from '../src/sim/bulletin';
import { hire, reviewWages } from '../src/sim/citizens';
import { generateCandidates } from '../src/sim/decision';
import { activeEffect, expireEffects } from '../src/sim/effects';
import { neighbourhood, pollutionAt } from '../src/sim/environment';
import { pushEvent } from '../src/sim/events';
import { checkMilestones, cityRank } from '../src/sim/milestones';
import { distanceField } from '../src/sim/navigation';
import { happinessFactors } from '../src/sim/needs';
import { COSTS, IMPORT_POWER, PETITION_GRACE_TICKS, onEffectsEnded, resolvePetition, updatePetitions } from '../src/sim/petitions';
import { SAVE_VERSION, parseSave, serializeWorld } from '../src/sim/persistence';
import { buildingDemand, plantOutput, updatePower } from '../src/sim/power';
import { isWeekend, weekdayName } from '../src/sim/time';
import { updateWeather } from '../src/sim/weather';
import { atHour, byType, prime, world } from './helpers';

/** Jump to a given day (1-based) and hour without simulating. */
function at(w: ReturnType<typeof world>, day: number, hour: number) {
  w.tick = (day - 1) * TICKS_PER_DAY + hour * TICKS_PER_HOUR;
}

describe('calendar', () => {
  it('day 1 is a Monday and days 6–7 are the weekend', () => {
    expect(weekdayName(0)).toBe('Monday');
    expect(weekdayName(5 * TICKS_PER_DAY)).toBe('Saturday');
    expect(isWeekend(4 * TICKS_PER_DAY)).toBe(false);
    expect(isWeekend(6 * TICKS_PER_DAY + 10)).toBe(true);
    expect(isWeekend(7 * TICKS_PER_DAY)).toBe(false);
  });

  it('offices close on weekends but shops keep their staff working', () => {
    const w = world();
    const office = byType(w, 'office');
    const shop = byType(w, 'shop');
    const clerk = prime(w.citizens.find((c) => c.jobId === office.id)!);
    const keeper = prime(w.citizens.find((c) => c.jobId === shop.id)!);
    const hasWork = (c: typeof clerk) => generateCandidates(w, c, distanceField(w, c.pos)).some((x) => x.action === 'work');
    at(w, 3, 10); // Wednesday
    expect(hasWork(clerk)).toBe(true);
    at(w, 6, 10); // Saturday
    expect(hasWork(clerk)).toBe(false);
    expect(hasWork(keeper)).toBe(true);
    expect(happinessFactors(w, clerk).some((f) => f.label === 'Weekend')).toBe(true);
  });
});

describe('weather', () => {
  it('fronts advance to the forecast and log an event explaining the effects', () => {
    const w = world();
    w.weather = { kind: 'cloudy', untilTick: w.tick, forecast: 'storm' };
    updateWeather(w);
    expect(w.weather.kind).toBe('storm');
    expect(w.weather.untilTick).toBeGreaterThan(w.tick);
    const ev = w.events.find((e) => e.type === 'weather')!;
    expect(ev.causes[0]).toBe('Weather front: Overcast → Thunderstorm');
    expect(ev.causes.some((c) => c.includes('Solar output at 20%'))).toBe(true);
  });

  it('does nothing before the current front has run its course', () => {
    const w = world();
    const before = JSON.stringify(w.weather);
    updateWeather(w);
    expect(JSON.stringify(w.weather)).toBe(before);
  });

  it('rain cuts solar output and a heatwave raises demand in homes but not civic buildings', () => {
    const w = world();
    w.treasury = 10_000;
    atHour(w, 12);
    const solar = placeBuilding(w, 'solarArray', 4, 13).building!;
    w.weather.kind = 'clear';
    expect(plantOutput(w, solar)).toBe(14);
    w.weather.kind = 'rain';
    expect(plantOutput(w, solar)).toBe(4.9);
    w.weather.kind = 'heatwave';
    expect(buildingDemand(w, byType(w, 'house'))).toBeCloseTo(2.4);
    expect(buildingDemand(w, byType(w, 'clinic'))).toBe(3);
  });

  it('a heatwave hurts mood unless cooling centers are open', () => {
    const w = world();
    const c = w.citizens[0];
    w.weather.kind = 'heatwave';
    expect(happinessFactors(w, c).find((f) => f.label === 'Heatwave')?.value).toBeLessThan(0);
    w.effects.push({ kind: 'coolingCenters', label: 'Cooling centers open', startTick: w.tick, untilTick: w.tick + 100, value: 0 });
    expect(happinessFactors(w, c).some((f) => f.label === 'Heatwave')).toBe(false);
  });
});

describe('pollution and neighbourhoods', () => {
  it('a home beside the factory breathes polluted air; a distant one does not', () => {
    const w = world();
    w.treasury = 10_000;
    const near = placeBuilding(w, 'house', 25, 15).building!;
    const far = placeBuilding(w, 'house', 4, 13).building!;
    expect(neighbourhood(w, near).pollution).toBeGreaterThan(0.5);
    expect(neighbourhood(w, far).pollution).toBe(0);
    const c = w.citizens[0];
    c.homeId = near.id;
    const polluted = happinessFactors(w, c).find((f) => f.label === 'Polluted air');
    expect(polluted?.value).toBeLessThan(-5);
  });

  it('an idle factory with no staff stops polluting, and parks clean the air', () => {
    const w = world();
    const factory = byType(w, 'factory');
    const p0 = pollutionAt(w, 26, 16);
    w.treasury = 10_000;
    expect(placeBuilding(w, 'park', 25, 15).ok).toBe(true);
    expect(pollutionAt(w, 26, 16)).toBeLessThan(p0);
    for (const c of w.citizens) if (c.jobId === factory.id) c.jobId = null;
    expect(pollutionAt(w, 26, 16)).toBe(0);
  });
});

describe('approval and elections', () => {
  it('approval itemises unemployment and drifts towards its target', () => {
    const w = world();
    for (const c of w.citizens.slice(0, 10)) c.jobId = null;
    const factors = approvalFactors(w);
    expect(factors.find((f) => f.label.startsWith('Unemployment'))!.value).toBeLessThan(-20);
    const before = w.approval.value;
    const target = targetApproval(factors);
    updateApproval(w);
    expect(w.approval.value).toBeLessThan(before);
    expect(w.approval.value).toBeGreaterThan(target);
  });

  it('winning an election starts a new term and pays a grant from outside the city', () => {
    const w = world();
    const money = totalMoney(w);
    const treasury = w.treasury;
    const grant = electionGrant(w);
    w.tick = w.election.nextTick;
    w.approval.value = 70;
    checkElection(w);
    expect(w.election.term).toBe(2);
    expect(w.treasury).toBe(treasury + grant);
    expect(totalMoney(w)).toBe(money);
    expect(w.gameOver).toBeNull();
    expect(w.election.nextTick).toBe(14 * TICKS_PER_DAY);
  });

  it('losing ends the game; sandbox mode skips later elections', () => {
    const w = world();
    w.tick = w.election.nextTick;
    w.approval.value = 20;
    checkElection(w);
    expect(w.gameOver?.reason).toMatch(/Voted out with 20% approval \(needed 40%\)/);
    expect(w.events.at(-1)!.severity).toBe('critical');
    w.gameOver = null;
    w.sandbox = true;
    w.tick = w.election.nextTick;
    checkElection(w);
    expect(w.election.history.length).toBe(1);
  });

  it('a collapsed economy gets the mayor voted out by simulation alone', { timeout: 30_000 }, () => {
    const w = world(4, { difficulty: 'hard' });
    expect(w.treasury).toBe(3500);
    for (const b of w.buildings) if (['office', 'factory', 'shop', 'market'].includes(b.type)) b.status = 'closed';
    for (const c of w.citizens) if (c.jobId !== null && byType(w, 'cityHall').id !== c.jobId) c.jobId = null;
    stepTicks(w, w.election.nextTick - w.tick + 1);
    expect(w.election.history.length).toBe(1);
    expect(w.election.history[0].won).toBe(false);
    expect(w.gameOver).not.toBeNull();
  });
});

describe('milestones and ranks', () => {
  it('building a solar array completes two milestones and pays conserved grants', () => {
    const w = world();
    const money = totalMoney(w);
    expect(placeBuilding(w, 'solarArray', 4, 13).ok).toBe(true);
    const treasury = w.treasury;
    checkMilestones(w);
    expect(w.milestones.groundbreaking).toBe(w.tick);
    expect(w.milestones.cleanEnergy).toBe(w.tick);
    expect(w.treasury).toBe(treasury + 200 + 300);
    expect(totalMoney(w)).toBe(money);
    checkMilestones(w);
    expect(w.treasury).toBe(treasury + 500); // awarded only once
  });

  it('the school stays locked until the city reaches Town rank', () => {
    const w = world();
    expect(placeBuilding(w, 'school', 4, 13)).toEqual({ ok: false, reason: 'Unlocks at Town rank' });
    w.milestones.town = w.tick;
    expect(cityRank(w)).toBe(1);
    expect(placeBuilding(w, 'school', 4, 13).ok).toBe(true);
  });

  it('sustained milestones need the condition to hold for consecutive hours', () => {
    const w = world();
    for (const c of w.citizens) c.needs.happiness = 90;
    for (let i = 0; i < 23; i++) checkMilestones(w);
    expect(w.milestones.thriving).toBeUndefined();
    w.citizens[0].needs.happiness = 0;
    for (const c of w.citizens) c.needs.happiness = 50;
    checkMilestones(w);
    expect(w.eventState.streaks['milestone:thriving']).toBe(0);
  });

  it('a staffed school nearby earns residents raises as their skills grow', () => {
    const w = world();
    w.milestones.town = w.tick;
    w.treasury = 10_000;
    const school = placeBuilding(w, 'school', 4, 13).building!;
    hire(w, w.citizens.find((c) => c.jobId === null)!, school);
    const apartment = byType(w, 'apartment');
    expect(neighbourhood(w, apartment).school).toBe(true);
    const worker = w.citizens.find((c) => c.jobId === byType(w, 'office').id)!;
    const wage = worker.wage;
    worker.skills.technical = Math.min(1, worker.skills.technical + 0.3);
    expect(reviewWages(w)).toContain(worker);
    expect(worker.wage).toBeGreaterThan(wage);
    expect(worker.memories.at(-1)!.text).toMatch(/Got a raise/);
  });
});

describe('petitions', () => {
  function ready() {
    const w = world();
    w.tick = PETITION_GRACE_TICKS;
    return w;
  }

  it('a struggling business asks for a bailout, and funding it moves exact money', () => {
    const w = ready();
    const shop = byType(w, 'shop');
    shop.distressHours = 3;
    updatePetitions(w);
    const p = w.petitions.find((x) => x.kind === 'bailout')!;
    expect(p.buildingId).toBe(shop.id);
    expect(p.causes.some((c) => c.includes('Distressed for 3 hours'))).toBe(true);
    const funds = shop.funds;
    const treasury = w.treasury;
    expect(resolvePetition(w, p.id, 'fund').ok).toBe(true);
    expect(shop.funds).toBe(funds + COSTS.bailout);
    expect(w.treasury).toBe(treasury - COSTS.bailout);
    expect(shop.distressHours).toBe(0);
    expect(resolvePetition(w, p.id, 'fund').ok).toBe(false);
  });

  it('cannot accept an option the treasury cannot afford', () => {
    const w = ready();
    byType(w, 'shop').distressHours = 3;
    updatePetitions(w);
    const p = w.petitions[0];
    w.treasury = 100;
    const r = resolvePetition(w, p.id, 'fund');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Needs 400 cr/);
    expect(w.petitions).toContain(p);
  });

  it('unanswered petitions apply their default option when they expire', () => {
    const w = ready();
    w.policies.incomeTaxRate = 0.25;
    for (const c of w.citizens) c.needs.happiness = 40;
    updatePetitions(w);
    const p = w.petitions.find((x) => x.kind === 'taxRelief')!;
    w.tick = p.expiresAt;
    updatePetitions(w);
    expect(w.petitions.some((x) => x.id === p.id)).toBe(false);
    expect(w.approval.modifiers.some((m) => m.label === 'Ignored tax petition' && m.value === -5)).toBe(true);
    expect(w.events.some((e) => e.title === 'No response: Keep current rate')).toBe(true);
  });

  it('buying emergency power adds supply for 24 hours', () => {
    const w = ready();
    w.power.shortage = true;
    w.eventState.streaks.shortageHours = 1;
    updatePetitions(w);
    const p = w.petitions.find((x) => x.kind === 'powerImport')!;
    expect(resolvePetition(w, p.id, 'buy').ok).toBe(true);
    updatePower(w);
    expect(w.power.supply).toBe(60 + IMPORT_POWER);
    w.tick += 24 * TICKS_PER_HOUR;
    onEffectsEnded(w, expireEffects(w));
    updatePower(w);
    expect(w.power.supply).toBe(60);
  });

  it('a weekend festival lifts every citizen’s mood', () => {
    const w = world();
    at(w, 6, 10);
    updatePetitions(w);
    const p = w.petitions.find((x) => x.kind === 'festival')!;
    expect(resolvePetition(w, p.id, 'host').ok).toBe(true);
    expect(activeEffect(w, 'festival')).toBeDefined();
    expect(happinessFactors(w, w.citizens[0]).find((f) => f.label === 'City festival')?.value).toBe(6);
  });

  it('a park promise is rewarded when kept and punished when broken', () => {
    const kept = ready();
    updatePetitions(kept);
    const p = kept.petitions.find((x) => x.kind === 'parkRequest')!;
    resolvePetition(kept, p.id, 'promise');
    kept.treasury = 10_000;
    expect(placeBuilding(kept, 'park', 4, 13).ok).toBe(true);
    updatePetitions(kept);
    expect(kept.approval.modifiers.some((m) => m.label === 'Kept park promise')).toBe(true);

    const broken = ready();
    updatePetitions(broken);
    resolvePetition(broken, broken.petitions.find((x) => x.kind === 'parkRequest')!.id, 'promise');
    broken.tick += 72 * TICKS_PER_HOUR;
    onEffectsEnded(broken, expireEffects(broken));
    expect(broken.approval.modifiers.some((m) => m.label === 'Broke park promise' && m.value === -8)).toBe(true);
  });
});

describe('morning bulletin', () => {
  it('leads with the most serious news of the last day', () => {
    const w = world();
    stepTicks(w, 2 * TICKS_PER_HOUR);
    pushEvent(w, { type: 'businessClosure', severity: 'critical', title: 'Shop #10 has closed', description: '', causes: [] });
    const b = makeBulletin(w);
    expect(b.headline).toBe('Shop #10 shuts its doors');
    expect(b.figures.find((f) => f.label === 'Population')?.value).toBe('20');
  });

  it('is published every morning at 06:00 from day 2', () => {
    const w = world();
    stepTicks(w, TICKS_PER_DAY - 1);
    expect(w.bulletins.length).toBe(0);
    stepTicks(w, 1);
    expect(w.bulletins.length).toBe(1);
    expect(w.bulletins[0].day).toBe(2);
    expect(w.bulletins[0].weather).toMatch(/^Tuesday · /);
  });
});

describe('save format v2', () => {
  it('migrates a version 1 save and fills in the new systems', () => {
    const w = world(12);
    stepTicks(w, 100);
    const file = JSON.parse(serializeWorld(w, 'then'));
    for (const k of ['difficulty', 'weather', 'approval', 'election', 'milestones', 'petitions', 'nextPetitionId', 'effects', 'bulletins', 'gameOver', 'sandbox']) delete file.world[k];
    file.version = 1;
    const r = parseSave(JSON.stringify(file));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(SAVE_VERSION).toBe(2);
    expect(r.world.weather.kind).toBe('clear');
    expect(r.world.election.nextTick).toBe(7 * TICKS_PER_DAY);
    expect(r.world.approval.value).toBeGreaterThan(0);
    stepTicks(r.world, TICKS_PER_DAY); // runs normally after migration
    expect(r.world.bulletins.length).toBe(1);
  });

  it('rejects corrupted petitions and effects', () => {
    const w = world();
    w.tick = PETITION_GRACE_TICKS;
    byType(w, 'shop').distressHours = 3;
    updatePetitions(w);
    const text = serializeWorld(w, '');
    const bad = JSON.parse(text);
    bad.world.petitions.push({ ...bad.world.petitions[0] });
    expect(parseSave(JSON.stringify(bad))).toMatchObject({ ok: false, error: expect.stringContaining('Duplicate petition id') });
    const bad2 = JSON.parse(text);
    bad2.world.effects = [{ kind: 'magic', startTick: 0, untilTick: 1, value: 0 }];
    expect(parseSave(JSON.stringify(bad2)).ok).toBe(false);
  });
});
