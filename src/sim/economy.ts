// Money movement. Every credit moves through `transfer`, which refuses to
// overdraw any internal account. The outside world ("external") is the only
// account allowed to go negative, so total money is conserved.

import { BUILDING_DEFS, ROAD_UPKEEP_PER_DAY, buildingLabel, canSell, employeesOf, isOperational, isRetail } from './buildings';
import { ECONOMY, PRICES, TICKS_PER_DAY, TICKS_PER_HOUR } from './constants';
import { manhattan } from './map';
import type { Building, Citizen, World } from './types';

export type Account =
  | { kind: 'treasury' }
  | { kind: 'external' }
  | { kind: 'citizen'; citizen: Citizen }
  | { kind: 'building'; building: Building };

export const TREASURY: Account = { kind: 'treasury' };
export const EXTERNAL: Account = { kind: 'external' };
export const citizenAcct = (citizen: Citizen): Account => ({ kind: 'citizen', citizen });
/** Public buildings are paid for directly by the treasury. */
export const buildingAcct = (building: Building): Account =>
  BUILDING_DEFS[building.type].isPublic ? TREASURY : { kind: 'building', building };

export function roundMoney(x: number): number {
  return Math.round(x * 100) / 100;
}

export function balanceOf(world: World, a: Account): number {
  switch (a.kind) {
    case 'treasury':
      return world.treasury;
    case 'external':
      return Infinity;
    case 'citizen':
      return a.citizen.money;
    case 'building':
      return a.building.funds;
  }
}

function adjust(world: World, a: Account, delta: number): void {
  switch (a.kind) {
    case 'treasury':
      world.treasury = roundMoney(world.treasury + delta);
      break;
    case 'external':
      world.ledger.external = roundMoney(world.ledger.external + delta);
      break;
    case 'citizen':
      a.citizen.money = roundMoney(a.citizen.money + delta);
      break;
    case 'building':
      a.building.funds = roundMoney(a.building.funds + delta);
      break;
  }
}

function recordTreasury(world: World, category: string, delta: number): void {
  world.ledger.today[category] = roundMoney((world.ledger.today[category] ?? 0) + delta);
}

/**
 * Move money between accounts. Returns false (and changes nothing) if the
 * amount is invalid or the payer cannot afford it.
 */
export function transfer(world: World, from: Account, to: Account, amount: number, category: string): boolean {
  const amt = roundMoney(amount);
  if (!Number.isFinite(amt) || amt <= 0) return false;
  if (balanceOf(world, from) < amt) return false;
  if (from.kind === 'treasury' && to.kind === 'treasury') return true;
  adjust(world, from, -amt);
  adjust(world, to, amt);
  if (from.kind === 'treasury') recordTreasury(world, category, -amt);
  if (to.kind === 'treasury') recordTreasury(world, category, amt);
  return true;
}

/** Total money held inside the city plus the external balance. Constant over time. */
export function totalMoney(world: World): number {
  let sum = world.treasury + world.ledger.external;
  for (const c of world.citizens) sum += c.money;
  for (const b of world.buildings) sum += b.funds;
  return roundMoney(sum);
}

/** Pay one tick of wages. Tax is withheld and sent to the treasury. */
export function payWage(world: World, citizen: Citizen, employer: Building): boolean {
  const gross = roundMoney(citizen.wage);
  if (gross <= 0) return false;
  const tax = roundMoney(gross * world.policies.incomeTaxRate);
  const net = roundMoney(gross - tax);
  const payer = buildingAcct(employer);
  if (balanceOf(world, payer) < gross) {
    employer.today.wagesUnpaid = roundMoney(employer.today.wagesUnpaid + gross);
    citizen.unpaidToday = roundMoney(citizen.unpaidToday + gross);
    return false;
  }
  const publicPayer = payer.kind === 'treasury';
  transfer(world, payer, citizenAcct(citizen), net, 'wages.public');
  if (!publicPayer) transfer(world, payer, TREASURY, tax, 'tax.income');
  employer.today.wagesPaid = roundMoney(employer.today.wagesPaid + gross);
  citizen.incomeToday = roundMoney(citizen.incomeToday + net);
  return true;
}

export type RetailItem = 'meal' | 'grocery' | 'luxury';

export function itemPrice(item: RetailItem, shop?: Building): number {
  return roundMoney(PRICES[item] * (shop ? BUILDING_DEFS[shop.type].priceFactor : 1));
}

/** Citizen buys `qty` items from a shop. Validates stock, opening and funds. */
export function buyRetail(world: World, citizen: Citizen, shop: Building, item: RetailItem, qty = 1): boolean {
  if (!Number.isInteger(qty) || qty <= 0) return false;
  if (!canSell(world, shop) || shop.stock < qty) return false;
  const total = roundMoney(itemPrice(item, shop) * qty);
  if (citizen.money < total) return false;
  const tax = roundMoney(total * world.policies.salesTaxRate);
  if (!transfer(world, citizenAcct(citizen), { kind: 'building', building: shop }, roundMoney(total - tax), 'sales')) return false;
  transfer(world, citizenAcct(citizen), TREASURY, tax, 'tax.sales');
  shop.stock = roundMoney(shop.stock - qty);
  shop.today.sales += qty;
  shop.today.revenue = roundMoney(shop.today.revenue + total - tax);
  return true;
}

/** Hourly: shops buy goods from local factories first, then import the rest. */
export function restockShops(world: World): void {
  const factories = world.buildings.filter((b) => b.type === 'factory' && b.status === 'operational' && b.connected);
  for (const shop of world.buildings) {
    if (!isRetail(shop) || shop.status !== 'operational' || !shop.connected) continue;
    if (shop.stock >= ECONOMY.shopRestockThreshold) continue;
    let need = Math.floor(ECONOMY.shopMaxStock - shop.stock);
    const sources = factories
      .filter((f) => f.stock >= 1)
      .sort((a, b) => manhattan(a.entrance, shop.entrance) - manhattan(b.entrance, shop.entrance) || a.id - b.id);
    for (const f of sources) {
      if (need <= 0) break;
      const qty = Math.min(need, Math.floor(f.stock), Math.floor(shop.funds / PRICES.wholesale));
      if (qty <= 0) break;
      if (transfer(world, { kind: 'building', building: shop }, { kind: 'building', building: f }, qty * PRICES.wholesale, 'wholesale')) {
        f.stock = roundMoney(f.stock - qty);
        f.today.revenue = roundMoney(f.today.revenue + qty * PRICES.wholesale);
        shop.stock += qty;
        need -= qty;
      }
    }
    if (need > 0) {
      const qty = Math.min(need, Math.floor(shop.funds / PRICES.import));
      if (qty > 0 && transfer(world, { kind: 'building', building: shop }, EXTERNAL, qty * PRICES.import, 'imports')) {
        shop.stock += qty;
      }
    }
  }
}

/** Hourly: factories sell surplus goods outside the city. */
export function exportSurplus(world: World): void {
  for (const f of world.buildings) {
    if (f.type !== 'factory' || f.status !== 'operational' || !f.connected) continue;
    const excess = Math.floor(f.stock - ECONOMY.factoryExportThreshold);
    if (excess <= 0) continue;
    if (transfer(world, EXTERNAL, { kind: 'building', building: f }, excess * PRICES.export, 'exports')) {
      f.stock = roundMoney(f.stock - excess);
      f.today.revenue = roundMoney(f.today.revenue + excess * PRICES.export);
    }
  }
}

/** Hourly operating costs and power fees for businesses. */
export function chargeBusinessCosts(world: World): void {
  for (const b of world.buildings) {
    const d = BUILDING_DEFS[b.type];
    if (d.isPublic || b.status !== 'operational') continue;
    if (d.operatingCostPerHour > 0) {
      const cost = Math.min(d.operatingCostPerHour, b.funds);
      transfer(world, { kind: 'building', building: b }, EXTERNAL, cost, 'operating');
    }
    if (d.jobs > 0 && b.powered && d.powerDemand > 0) {
      const fee = Math.min(d.powerDemand * ECONOMY.powerFee, b.funds);
      transfer(world, { kind: 'building', building: b }, TREASURY, fee, 'power.fees');
    }
  }
}

/** Hourly treasury upkeep for public buildings and roads. Tracks unpaid hours. */
export function payUpkeep(world: World): void {
  for (const b of world.buildings) {
    const d = BUILDING_DEFS[b.type];
    if (!d.isPublic || d.upkeepPerDay <= 0) continue;
    const hourly = d.upkeepPerDay / 24;
    if (transfer(world, TREASURY, EXTERNAL, hourly, 'upkeep')) {
      b.unpaidUpkeepHours = 0;
    } else {
      b.unpaidUpkeepHours += 1;
    }
  }
  const roads = world.tiles.reduce((n, t) => n + (t === 'road' ? 1 : 0), 0);
  transfer(world, TREASURY, EXTERNAL, Math.min(world.treasury, (roads * ROAD_UPKEEP_PER_DAY) / 24), 'upkeep');
}

export interface DailyBillResult {
  rentMissed: Citizen[];
}

/** Daily rent collection and unemployment benefits. */
export function collectRentAndBenefits(world: World): DailyBillResult {
  const rentMissed: Citizen[] = [];
  for (const c of world.citizens) {
    const home = world.buildings.find((b) => b.id === c.homeId);
    if (home) {
      const rent = BUILDING_DEFS[home.type].rentPerDay;
      if (!transfer(world, citizenAcct(c), TREASURY, rent, 'rent')) rentMissed.push(c);
      // Utilities are billed only if the home had power for most of the day.
      else if (home.today.unpoweredTicks < TICKS_PER_DAY / 2) transfer(world, citizenAcct(c), TREASURY, Math.min(c.money, PRICES.utilities), 'utilities');
    }
    if (c.jobId === null && world.policies.unemploymentBenefit > 0) {
      transfer(world, TREASURY, citizenAcct(c), world.policies.unemploymentBenefit, 'benefits');
    }
  }
  return { rentMissed };
}

export function hourlyPayroll(world: World, b: Building): number {
  return employeesOf(world, b.id).reduce((s, c) => s + c.wage, 0) * TICKS_PER_HOUR;
}

export interface ClosureInfo {
  building: Building;
  causes: string[];
  laidOff: Citizen[];
}

/**
 * Hourly solvency check. A business that cannot cover one hour of payroll for
 * ECONOMY.closureDistressHours consecutive hours closes and lays off its staff.
 */
export function checkSolvency(world: World): ClosureInfo[] {
  const closures: ClosureInfo[] = [];
  for (const b of world.buildings) {
    const d = BUILDING_DEFS[b.type];
    if (d.isPublic || d.jobs === 0 || b.status !== 'operational') continue;
    const payroll = hourlyPayroll(world, b);
    const distressed = payroll > 0 && b.funds < payroll;
    b.distressHours = distressed ? b.distressHours + 1 : 0;
    if (b.distressHours < ECONOMY.closureDistressHours) continue;

    const causes = [
      `Cash reserves ${b.funds.toFixed(0)} cr could not cover hourly payroll of ${payroll.toFixed(0)} cr for ${b.distressHours} hours`,
      `Revenue today ${b.today.revenue.toFixed(0)} cr vs wages owed ${(b.today.wagesPaid + b.today.wagesUnpaid).toFixed(0)} cr`,
    ];
    const outage = b.today.unpoweredTicks + b.yesterday.unpoweredTicks;
    if (outage > 0) causes.push(`Without power for ${(outage / TICKS_PER_HOUR).toFixed(1)} hours recently`);
    if (isRetail(b) && b.stock < 1) causes.push('Shelves empty: no goods to sell');
    if (!b.connected) causes.push('No road access for deliveries');
    if (!isOperational(b)) causes.push('Building was not operational');
    b.status = 'closed';
    b.distressHours = 0;
    const laidOff = employeesOf(world, b.id);
    closures.push({ building: b, causes, laidOff });
  }
  return closures;
}

export function closureTitle(b: Building): string {
  return `${buildingLabel(b)} has closed`;
}
