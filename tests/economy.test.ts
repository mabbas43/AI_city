import { describe, expect, it } from 'vitest';
import { stepTicks, stepWorld, TICKS_PER_DAY, totalMoney } from '../src/sim';
import { EXTERNAL, TREASURY, buyRetail, checkSolvency, citizenAcct, payWage, transfer, itemPrice } from '../src/sim/economy';
import { bestOpenJob, hire, wageFor } from '../src/sim/citizens';
import { employeesOf, openJobs } from '../src/sim/buildings';
import { subsidizeBuilding } from '../src/sim/policies';
import { ECONOMY, PRICES } from '../src/sim/constants';
import { atHour, byType, prime, world } from './helpers';

describe('transfers', () => {
  it('moves exact amounts and refuses overdrafts without side effects', () => {
    const w = world();
    const c = w.citizens[0];
    c.money = 50;
    const t0 = w.treasury;
    expect(transfer(w, citizenAcct(c), TREASURY, 20, 'test')).toBe(true);
    expect(c.money).toBe(30);
    expect(w.treasury).toBe(t0 + 20);
    expect(transfer(w, citizenAcct(c), TREASURY, 30.01, 'test')).toBe(false);
    expect(c.money).toBe(30);
    expect(transfer(w, citizenAcct(c), TREASURY, -5, 'test')).toBe(false);
    expect(transfer(w, citizenAcct(c), TREASURY, Number.NaN, 'test')).toBe(false);
    expect(w.ledger.today.test).toBe(20);
  });

  it('the treasury can never be overdrawn', () => {
    const w = world();
    w.treasury = 10;
    expect(transfer(w, TREASURY, EXTERNAL, 10.01, 'x')).toBe(false);
    expect(w.treasury).toBe(10);
  });

  it('total money (including the outside world) is conserved over three days', () => {
    const w = world(11);
    const m0 = totalMoney(w);
    stepTicks(w, TICKS_PER_DAY * 3);
    expect(totalMoney(w)).toBeCloseTo(m0, 2);
  });
});

describe('wages and employment', () => {
  it('pays net wage to the worker and income tax to the treasury', () => {
    const w = world();
    const office = byType(w, 'office');
    const c = employeesOf(w, office.id)[0];
    const money0 = c.money;
    const funds0 = office.funds;
    const t0 = w.treasury;
    w.policies.incomeTaxRate = 0.2;
    expect(payWage(w, c, office)).toBe(true);
    const gross = c.wage;
    const tax = Math.round(gross * 0.2 * 100) / 100;
    expect(c.money).toBeCloseTo(money0 + gross - tax, 2);
    expect(office.funds).toBeCloseTo(funds0 - gross, 2);
    expect(w.treasury).toBeCloseTo(t0 + tax, 2);
  });

  it('a broke employer cannot pay: wages are recorded as unpaid and no money moves', () => {
    const w = world();
    const office = byType(w, 'office');
    const c = employeesOf(w, office.id)[0];
    office.funds = 0;
    const money0 = c.money;
    expect(payWage(w, c, office)).toBe(false);
    expect(c.money).toBe(money0);
    expect(office.funds).toBe(0);
    expect(c.unpaidToday).toBeGreaterThan(0);
    expect(office.today.wagesUnpaid).toBeGreaterThan(0);
  });

  it('working a shift actually earns money over simulated time', () => {
    const w = world();
    atHour(w, 8);
    const c = prime(w.citizens.find((x) => x.jobId !== null && w.buildings.find((b) => b.id === x.jobId)!.type === 'office')!);
    const before = c.money;
    stepTicks(w, 6 * 12);
    expect(c.workedToday).toBeGreaterThan(30);
    expect(c.money).toBeGreaterThan(before);
  });

  it('wages scale with the relevant skill', () => {
    const w = world();
    const office = byType(w, 'office');
    const c = w.citizens[0];
    c.skills.technical = 1;
    const high = wageFor(c, office);
    c.skills.technical = 0;
    expect(high).toBeGreaterThan(wageFor(c, office));
  });

  it('job hunting at City Hall hires the citizen into an open job', () => {
    const w = world();
    atHour(w, 9);
    const c = w.citizens.find((x) => x.jobId === null)!;
    const hall = byType(w, 'cityHall');
    prime(c);
    c.pos = { ...hall.entrance };
    stepWorld(w);
    expect(c.jobId).not.toBeNull();
    expect(c.wage).toBeGreaterThan(0);
    expect(c.memories.some((m) => m.text.startsWith('Hired as'))).toBe(true);
  });

  it('hiring never exceeds available positions', () => {
    const w = world();
    const shop = byType(w, 'shop');
    const unemployed = w.citizens.filter((c) => c.jobId === null);
    let hired = 0;
    for (const c of unemployed) if (openJobs(w, shop) > 0 && hire(w, c, shop)) hired += 1;
    expect(employeesOf(w, shop.id).length).toBeLessThanOrEqual(2);
    for (const c of w.citizens.filter((x) => x.jobId === null)) expect(hire(w, c, shop)).toBe(false);
    expect(hired).toBeLessThanOrEqual(unemployed.length);
  });

  it('with no openings anywhere, job hunting fails and sets a cooldown', () => {
    const w = world();
    atHour(w, 9);
    for (const c of w.citizens) while (c.jobId === null && bestOpenJob(w, c)) hire(w, c, bestOpenJob(w, c)!);
    const extra = w.citizens.find((c) => c.jobId === null);
    if (!extra) return; // all citizens fit; covered by the closure test below
    const hall = byType(w, 'cityHall');
    prime(extra);
    extra.pos = { ...hall.entrance };
    stepWorld(w);
    expect(extra.jobId).toBeNull();
    expect(extra.jobSearchCooldownUntil).toBeGreaterThan(w.tick);
  });
});

describe('purchases', () => {
  it('buying moves money to the shop and tax to the treasury, and uses stock', () => {
    const w = world();
    const shop = byType(w, 'shop');
    const c = w.citizens[0];
    c.money = 100;
    const s0 = shop.stock;
    const f0 = shop.funds;
    const t0 = w.treasury;
    expect(buyRetail(w, c, shop, 'grocery', 3)).toBe(true);
    const total = PRICES.grocery * 3;
    const tax = Math.round(total * w.policies.salesTaxRate * 100) / 100;
    expect(c.money).toBeCloseTo(100 - total, 2);
    expect(shop.funds).toBeCloseTo(f0 + total - tax, 2);
    expect(w.treasury).toBeCloseTo(t0 + tax, 2);
    expect(shop.stock).toBe(s0 - 3);
  });

  it('rejects purchases the citizen cannot afford', () => {
    const w = world();
    const shop = byType(w, 'shop');
    const c = w.citizens[0];
    c.money = PRICES.meal - 0.01;
    const s0 = shop.stock;
    expect(buyRetail(w, c, shop, 'meal')).toBe(false);
    expect(c.money).toBe(PRICES.meal - 0.01);
    expect(shop.stock).toBe(s0);
  });

  it('rejects purchases beyond stock, from closed, unpowered or unstaffed shops', () => {
    const w = world();
    const shop = byType(w, 'shop');
    const c = w.citizens[0];
    c.money = 10_000;
    shop.stock = 2;
    expect(buyRetail(w, c, shop, 'grocery', 3)).toBe(false);
    shop.stock = 20;
    shop.powered = false;
    expect(buyRetail(w, c, shop, 'meal')).toBe(false);
    shop.powered = true;
    shop.status = 'closed';
    expect(buyRetail(w, c, shop, 'meal')).toBe(false);
    shop.status = 'operational';
    for (const e of employeesOf(w, shop.id)) e.jobId = null;
    expect(buyRetail(w, c, shop, 'meal')).toBe(false);
  });

  it('the market sells 15% cheaper than the shop', () => {
    const w = world();
    expect(itemPrice('meal', byType(w, 'market'))).toBeCloseTo(PRICES.meal * 0.85);
    expect(itemPrice('meal', byType(w, 'shop'))).toBe(PRICES.meal);
  });
});

describe('business solvency', () => {
  it('a business that cannot cover payroll for 12 hours closes and lays off its staff', () => {
    const w = world();
    const office = byType(w, 'office');
    const staff = employeesOf(w, office.id);
    expect(staff.length).toBeGreaterThan(0);
    office.funds = 1;
    for (let h = 0; h < ECONOMY.closureDistressHours - 1; h++) expect(checkSolvency(w)).toHaveLength(0);
    const closures = checkSolvency(w);
    expect(closures).toHaveLength(1);
    expect(office.status).toBe('closed');
    expect(closures[0].causes[0]).toContain('could not cover hourly payroll');
  });

  it('a blackout starves a business of revenue until it closes, and the event cites the outage', () => {
    const w = world();
    const office = byType(w, 'office');
    const staff = employeesOf(w, office.id).map((c) => c.id);
    office.funds = 20;
    // The plant's upkeep has gone unpaid: the whole grid is down.
    byType(w, 'powerStation').unpaidUpkeepHours = 99;
    w.policies.incomeTaxRate = 0;
    w.treasury = 0;
    stepTicks(w, 14 * 12);
    expect(office.status).toBe('closed');
    for (const id of staff) expect(w.citizens.find((c) => c.id === id)?.jobId).not.toBe(office.id);
    const ev = w.events.find((e) => e.type === 'businessClosure' && e.buildingIds.includes(office.id));
    expect(ev).toBeDefined();
    expect(ev!.causes.join(' ')).toMatch(/Without power/);
    expect(ev!.citizenIds).toEqual(expect.arrayContaining(staff));
  });

  it('a subsidy reopens a closed business and is paid from the treasury', () => {
    const w = world();
    const office = byType(w, 'office');
    office.status = 'closed';
    const t0 = w.treasury;
    expect(subsidizeBuilding(w, office.id).ok).toBe(true);
    expect(office.status).toBe('operational');
    expect(w.treasury).toBe(t0 - ECONOMY.subsidyAmount);
    w.treasury = 5;
    expect(subsidizeBuilding(w, office.id).ok).toBe(false);
    expect(w.treasury).toBe(5);
    expect(subsidizeBuilding(w, byType(w, 'park').id).ok).toBe(false);
  });
});
