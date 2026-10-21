// Causal event system. Every event is produced by an explicit condition on
// the simulation state, and records the concrete values that triggered it.
// Nothing here uses randomness.

import { BUILDING_DEFS, buildingLabel, canSell, employeesOf, getBuilding, isOperational, isRetail } from './buildings';
import { POPULATION, PRICES, TICKS_PER_DAY, TICKS_PER_HOUR } from './constants';
import { UPKEEP_SHUTDOWN_HOURS, isDaylight } from './power';
import { cityStats, pct } from './stats';
import type { CityEvent, Citizen, EventSeverity, EventType, World } from './types';

export interface EventInput {
  type: EventType;
  severity: EventSeverity;
  title: string;
  description: string;
  causes: string[];
  citizenIds?: number[];
  buildingIds?: number[];
}

export function pushEvent(world: World, input: EventInput): CityEvent {
  const ev: CityEvent = {
    id: world.nextEventId++,
    tick: world.tick,
    type: input.type,
    severity: input.severity,
    title: input.title,
    description: input.description,
    causes: input.causes,
    citizenIds: input.citizenIds ?? [],
    buildingIds: input.buildingIds ?? [],
  };
  world.events.push(ev);
  world.eventState.lastFired[input.type] = world.tick;
  if (world.events.length > POPULATION.maxEvents) world.events.splice(0, world.events.length - POPULATION.maxEvents);
  return ev;
}

/** Updates a boolean condition flag; reports rising/falling edges. */
function edge(world: World, key: string, on: boolean, off: boolean): 'rose' | 'fell' | null {
  const was = !!world.eventState.flags[key];
  if (!was && on) {
    world.eventState.flags[key] = true;
    return 'rose';
  }
  if (was && off) {
    world.eventState.flags[key] = false;
    return 'fell';
  }
  return null;
}

/** Counts consecutive checks for which `cond` held. */
function streak(world: World, key: string, cond: boolean): number {
  const v = cond ? (world.eventState.streaks[key] ?? 0) + 1 : 0;
  world.eventState.streaks[key] = v;
  return v;
}

function listBuildings(world: World, ids: number[], max = 4): string {
  const labels = ids.slice(0, max).map((id) => {
    const b = getBuilding(world, id);
    return b ? buildingLabel(b) : `#${id}`;
  });
  return ids.length > max ? `${labels.join(', ')} and ${ids.length - max} more` : labels.join(', ');
}

/** Checked every tick: power shortages start instantly, recovery needs an hour of surplus. */
export function detectPowerEvents(world: World): void {
  const p = world.power;
  const surplusStreak = streak(world, 'powerSurplus', !p.shortage);
  const change = edge(world, 'powerShortage', p.shortage, surplusStreak >= TICKS_PER_HOUR);
  if (change === 'rose') {
    const causes = [`Demand ${p.demand} exceeds supply ${p.supply}`];
    for (const b of world.buildings) {
      const d = BUILDING_DEFS[b.type];
      if (d.powerSupply <= 0) continue;
      if (b.unpaidUpkeepHours >= UPKEEP_SHUTDOWN_HOURS) causes.push(`${buildingLabel(b)} offline: upkeep unpaid for ${b.unpaidUpkeepHours} hours`);
      else if (b.type === 'solarArray' && !isDaylight(world.tick)) causes.push(`${buildingLabel(b)} at night output`);
      else if (b.type === 'powerStation' && employeesOf(world, b.id).length === 0) causes.push(`${buildingLabel(b)} unstaffed: running at half output`);
    }
    if (p.unpoweredIds.length) causes.push(`Cut off: ${listBuildings(world, p.unpoweredIds)}`);
    pushEvent(world, {
      type: 'powerShortage',
      severity: 'critical',
      title: 'Power shortage',
      description: `The grid cannot meet demand. ${p.unpoweredIds.length} buildings lost power, starting with the lowest-priority consumers.`,
      causes,
      buildingIds: [...p.unpoweredIds],
    });
  } else if (change === 'fell') {
    pushEvent(world, {
      type: 'powerRestored',
      severity: 'info',
      title: 'Power restored',
      description: 'Supply has covered demand for a full hour. All buildings are back on the grid.',
      causes: [`Supply ${p.supply} now covers demand ${p.demand}`],
    });
  }
}

const COMPLAINTS_PER_HOUR = 2;

interface Grievance {
  key: string;
  title: string;
  causes: string[];
  buildingIds?: number[];
}

function grievancesOf(world: World, c: Citizen): Grievance[] {
  const out: Grievance[] = [];
  const home = getBuilding(world, c.homeId);
  const selling = world.buildings.filter((b) => canSell(world, b)).length;
  const noFood = c.food === 0 || !home;
  if (c.needs.hunger >= 75 && noFood && (selling === 0 || c.money < PRICES.meal)) {
    const causes = [`Hunger at ${Math.round(c.needs.hunger)}`, `${c.food} groceries at home`, `${c.money.toFixed(0)} cr available`];
    causes.push(selling === 0 ? 'No shop is currently able to sell food' : `Cannot afford a ${PRICES.meal} cr meal`);
    out.push({ key: 'hunger', title: `${c.name} cannot get enough food`, causes });
  }
  if (!home) {
    const s = cityStats(world);
    out.push({ key: 'homeless', title: `${c.name} has nowhere to live`, causes: [`Housing capacity ${s.housingCapacity} for ${s.population} citizens`, `${s.vacantHomes} vacant homes`] });
  } else if (!home.powered) {
    out.push({
      key: 'power',
      title: `${c.name} complains about a blackout at home`,
      causes: [`${buildingLabel(home)} is unpowered`, `Grid demand ${world.power.demand} vs supply ${world.power.supply}`],
      buildingIds: [home.id],
    });
  }
  if (c.unpaidToday > 0) {
    const job = getBuilding(world, c.jobId);
    out.push({
      key: 'unpaid',
      title: `${c.name} has not been paid`,
      causes: [`${c.unpaidToday.toFixed(0)} cr of wages unpaid today`, job ? `${buildingLabel(job)} has ${job.funds.toFixed(0)} cr in funds` : 'Employer unknown'],
      buildingIds: job ? [job.id] : [],
    });
  }
  if (c.jobId === null && c.ticksUnemployed >= TICKS_PER_DAY) {
    const s = cityStats(world);
    out.push({
      key: 'jobless',
      title: `${c.name} cannot find work`,
      causes: [`Unemployed for ${(c.ticksUnemployed / TICKS_PER_DAY).toFixed(1)} days`, `${s.openJobs} open positions in the city`],
    });
  }
  if (c.needs.health < 40) {
    const clinics = world.buildings.filter((b) => b.type === 'clinic');
    const working = clinics.filter((b) => isOperational(b) && employeesOf(world, b.id).length > 0);
    if (working.length === 0) {
      out.push({
        key: 'health',
        title: `${c.name} is sick and cannot get care`,
        causes: [`Health at ${Math.round(c.needs.health)}`, clinics.length === 0 ? 'The city has no clinic' : 'No clinic is powered and staffed'],
      });
    }
  }
  return out;
}

function detectComplaints(world: World): void {
  const n = world.citizens.length;
  if (n === 0) return;
  let made = 0;
  const offset = Math.floor(world.tick / TICKS_PER_HOUR) % n;
  for (let i = 0; i < n && made < COMPLAINTS_PER_HOUR; i++) {
    const c = world.citizens[(offset + i) % n];
    for (const g of grievancesOf(world, c)) {
      const last = c.complaintCooldowns[g.key];
      if (last !== undefined && world.tick - last < TICKS_PER_DAY) continue;
      c.complaintCooldowns[g.key] = world.tick;
      pushEvent(world, {
        type: 'complaint',
        severity: 'warning',
        title: g.title,
        description: `${c.name} (${c.occupation}) filed a complaint with City Hall.`,
        causes: g.causes,
        citizenIds: [c.id],
        buildingIds: g.buildingIds,
      });
      made += 1;
      break;
    }
  }
}

function negativeFactorSummary(citizens: Citizen[]): string[] {
  const counts = new Map<string, number>();
  for (const c of citizens) for (const f of c.happinessFactors) if (f.value < 0) counts.set(f.label, (counts.get(f.label) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([label, count]) => `${label}: ${count} of the unhappy citizens`);
}

function detectProtest(world: World): void {
  const pop = world.citizens.length;
  const unhappy = world.citizens.filter((c) => c.needs.happiness < 30);
  const share = pop ? unhappy.length / pop : 0;
  const sustained = streak(world, 'unhappy', pop >= 5 && share >= 0.3);
  const change = edge(world, 'protest', sustained >= 3, share < 0.2);
  const s = cityStats(world);
  if (change === 'rose') {
    pushEvent(world, {
      type: 'protest',
      severity: 'critical',
      title: 'Citizens protest at City Hall',
      description: `${unhappy.length} unhappy citizens are gathering at City Hall. Protesters skip work until conditions improve.`,
      causes: [`${pct(share)} of citizens have happiness below 30 for ${sustained} hours`, `Average happiness ${s.avgHappiness.toFixed(0)}`, ...negativeFactorSummary(unhappy)],
      citizenIds: unhappy.map((c) => c.id),
    });
  } else if (change === 'fell') {
    pushEvent(world, {
      type: 'protestEnded',
      severity: 'info',
      title: 'Protest disperses',
      description: 'Enough citizens are satisfied that the protest has ended.',
      causes: [`Only ${pct(share)} of citizens remain very unhappy`, `Average happiness ${s.avgHappiness.toFixed(0)}`],
    });
  }
}

function detectUnemployment(world: World): void {
  const s = cityStats(world);
  const change = edge(world, 'unemployment', s.population >= 5 && s.unemploymentRate >= 0.2, s.unemploymentRate < 0.15);
  if (change !== 'rose') return;
  const causes = [`${s.unemployed} of ${s.population} citizens unemployed (${pct(s.unemploymentRate)})`, `${s.openJobs} open positions across the city`];
  if (s.closedBusinesses) causes.push(`${s.closedBusinesses} businesses closed`);
  const newcomers = world.citizens.filter((c) => c.jobId === null && world.tick - c.arrivedAt < TICKS_PER_DAY && c.arrivedAt > 0).length;
  if (newcomers) causes.push(`${newcomers} recent arrivals still looking for work`);
  const dark = world.buildings.filter((b) => BUILDING_DEFS[b.type].jobs > 0 && !b.powered).length;
  if (dark) causes.push(`${dark} workplaces without power`);
  pushEvent(world, {
    type: 'unemployment',
    severity: 'warning',
    title: 'Unemployment is high',
    description: 'More than a fifth of the population is out of work.',
    causes,
    citizenIds: world.citizens.filter((c) => c.jobId === null).map((c) => c.id),
  });
}

/** Daily: compares unemployment to the previous day. */
export function detectUnemploymentTrend(world: World): void {
  const s = cityStats(world);
  const prev = world.dailyUnemployment[world.dailyUnemployment.length - 1];
  world.dailyUnemployment.push(Math.round(s.unemploymentRate * 1000) / 1000);
  if (world.dailyUnemployment.length > 30) world.dailyUnemployment.shift();
  if (prev === undefined || s.unemploymentRate - prev < 0.1) return;
  pushEvent(world, {
    type: 'unemployment',
    severity: 'warning',
    title: 'Unemployment is rising',
    description: 'Joblessness rose sharply over the last day.',
    causes: [`Unemployment rose from ${pct(prev)} to ${pct(s.unemploymentRate)} in one day`, `${s.openJobs} open positions`, `${s.closedBusinesses} businesses closed`],
  });
}

function detectGoodsShortage(world: World): void {
  const shops = world.buildings.filter((b) => isRetail(b) && b.status === 'operational');
  const empty = shops.length > 0 && shops.every((b) => b.stock < 1);
  const change = edge(world, 'goodsShortage', empty, !empty);
  if (change !== 'rose') return;
  const factories = world.buildings.filter((b) => b.type === 'factory');
  const causes = [`All ${shops.length} shops have empty shelves`];
  if (factories.length === 0) causes.push('The city has no factory producing goods');
  else causes.push(`Factory stock: ${factories.map((f) => `${buildingLabel(f)} ${Math.floor(f.stock)}`).join(', ')}`);
  const broke = shops.filter((b) => b.funds < PRICES.import);
  if (broke.length) causes.push(`${broke.length} shops cannot afford imports`);
  const disconnected = shops.filter((b) => !b.connected);
  if (disconnected.length) causes.push(`${disconnected.length} shops lack road access for deliveries`);
  pushEvent(world, { type: 'goodsShortage', severity: 'warning', title: 'Goods shortage', description: 'Shops have run out of goods.', causes, buildingIds: shops.map((b) => b.id) });
}

export function dailyPublicCosts(world: World): number {
  let cost = 0;
  for (const b of world.buildings) {
    const d = BUILDING_DEFS[b.type];
    if (!d.isPublic) continue;
    cost += d.upkeepPerDay;
    cost += employeesOf(world, b.id).reduce((s, c) => s + c.wage * 96, 0);
  }
  return cost;
}

function detectBudgetCrisis(world: World): void {
  const daily = dailyPublicCosts(world);
  const change = edge(world, 'budgetCrisis', world.treasury < daily, world.treasury > daily * 2);
  if (change !== 'rose') return;
  const y = world.ledger.yesterday;
  const income = Object.values(y).filter((v) => v > 0).reduce((s, v) => s + v, 0);
  const expense = -Object.values(y).filter((v) => v < 0).reduce((s, v) => s + v, 0);
  const causes = [`Treasury ${world.treasury.toFixed(0)} cr is below one day of public costs (${daily.toFixed(0)} cr)`, `Yesterday: income ${income.toFixed(0)} cr, spending ${expense.toFixed(0)} cr`];
  const unpaid = world.buildings.filter((b) => b.unpaidUpkeepHours > 0);
  if (unpaid.length) causes.push(`Upkeep overdue at ${listBuildings(world, unpaid.map((b) => b.id))}`);
  pushEvent(world, { type: 'budgetCrisis', severity: 'critical', title: 'Budget crisis', description: 'The treasury cannot sustain public services much longer. Unpaid plants will shut down.', causes });
}

function detectHousing(world: World): void {
  const s = cityStats(world);
  const sustained = streak(world, 'homeless', s.homeless > 0);
  const change = edge(world, 'housingShortage', sustained >= 2, s.homeless === 0);
  if (change !== 'rose') return;
  pushEvent(world, {
    type: 'housingShortage',
    severity: 'warning',
    title: 'Housing shortage',
    description: `${s.homeless} citizens are sleeping rough.`,
    causes: [`${s.homeless} homeless for at least 2 hours`, `Housing capacity ${s.housingCapacity}, population ${s.population}`, `${s.vacantHomes} vacant homes`],
    citizenIds: world.citizens.filter((c) => c.homeId === null).map((c) => c.id),
  });
}

function detectHealth(world: World): void {
  const pop = world.citizens.length;
  const sick = world.citizens.filter((c) => c.needs.health < 40);
  const share = pop ? sick.length / pop : 0;
  const change = edge(world, 'healthCrisis', pop >= 5 && share >= 0.25, share < 0.1);
  if (change !== 'rose') return;
  const clinics = world.buildings.filter((b) => b.type === 'clinic');
  const causes = [`${sick.length} of ${pop} citizens have health below 40`];
  if (!clinics.length) causes.push('No clinic in the city');
  else for (const cl of clinics) if (!isOperational(cl) || employeesOf(world, cl.id).length === 0) causes.push(`${buildingLabel(cl)} is ${!cl.powered ? 'unpowered' : 'unstaffed'}`);
  const hungry = sick.filter((c) => c.needs.hunger > 80).length;
  if (hungry) causes.push(`${hungry} of them are starving`);
  const tired = sick.filter((c) => c.needs.energy < 15).length;
  if (tired) causes.push(`${tired} of them are exhausted`);
  pushEvent(world, { type: 'healthCrisis', severity: 'warning', title: 'Public health crisis', description: 'Many citizens are falling ill.', causes, citizenIds: sick.map((c) => c.id) });
}

/** Hourly detectors. */
export function detectHourlyEvents(world: World): void {
  detectUnemployment(world);
  detectGoodsShortage(world);
  detectBudgetCrisis(world);
  detectHousing(world);
  detectHealth(world);
  detectProtest(world);
  detectComplaints(world);
}
