// Activity state machine: idle -> traveling -> performing -> idle.
// Every transition re-validates the world so citizens never get stuck on a
// demolished, closed or unreachable target.

import { buildingLabel, employeesOf, getBuilding, isOperational, openJobs } from './buildings';
import { adjustRelationship, bestOpenJob, clamp, compatibility, hire, remember } from './citizens';
import { ECONOMY, GUARDS, NEEDS, PRICES, TICKS_PER_DAY, TICKS_PER_HOUR, WORK } from './constants';
import { type Candidate, GROCERY_TARGET, LUXURY_MIN_MONEY, SPENDING_RESERVE } from './decision';
import { EXTERNAL, TREASURY, buyRetail, citizenAcct, itemPrice, payWage, roundMoney, transfer } from './economy';
import { blockedGrid, tileIndex } from './map';
import { extractPath, findPath, stepCost, type DistanceField } from './navigation';
import { restRate } from './needs';
import { hourOf, isNight } from './time';
import type { ActionKind, Building, Citizen, Point, World } from './types';

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

export function goIdle(c: Citizen, wait = 0): void {
  c.activity = { kind: 'idle', wait };
}

function maxTicksFor(world: World, c: Citizen, action: ActionKind): number {
  switch (action) {
    case 'work': {
      const untilEnd = Math.ceil((WORK.endHour - hourOf(world.tick)) * TICKS_PER_HOUR);
      return Math.max(1, Math.min(WORK.blockTicks, WORK.shiftTicks - c.workedToday, untilEnd));
    }
    case 'rest':
      return isNight(world.tick) ? 9 * TICKS_PER_HOUR : 3 * TICKS_PER_HOUR;
    case 'eat':
      return 6;
    case 'shop':
      return 4;
    case 'socialize':
      return 2 * TICKS_PER_HOUR;
    case 'seekJob':
      return 3;
    case 'seekCare':
      return 2 * TICKS_PER_HOUR;
    case 'protest':
      return 3 * TICKS_PER_HOUR;
    case 'wait':
      return GUARDS.noOptionWait;
  }
}

/** Commit a citizen to a chosen candidate: travel there, or begin immediately if already there. */
export function startCandidate(world: World, c: Citizen, cand: Candidate, field: DistanceField): void {
  const targetId = cand.target?.id ?? null;
  if (samePoint(c.pos, cand.destination)) {
    beginPerforming(world, c, cand.action, targetId);
    return;
  }
  const path = extractPath(field, cand.destination);
  if (!path) {
    goIdle(c, GUARDS.noOptionWait);
    return;
  }
  c.insideId = null;
  c.activity = { kind: 'traveling', action: cand.action, targetId, destination: { ...cand.destination }, path, ticksTraveled: 0 };
}

/** Start an action at the current location; re-plans if arrival effects fail. */
function beginPerforming(world: World, c: Citizen, action: ActionKind, targetId: number | null): void {
  const target = getBuilding(world, targetId);
  if (targetId !== null && !target) {
    goIdle(c);
    return;
  }
  c.insideId = target?.id ?? null;
  if (!onArrive(world, c, action, target)) {
    goIdle(c, 1);
    return;
  }
  c.activity = { kind: 'performing', action, targetId, elapsed: 0, maxTicks: maxTicksFor(world, c, action) };
}

/** Arrival effects. Returns false if the action could not start. */
function onArrive(world: World, c: Citizen, action: ActionKind, target: Building | undefined): boolean {
  switch (action) {
    case 'work':
      return !!target && target.id === c.jobId && isOperational(target);
    case 'eat': {
      if (!target) return false;
      if (target.id === c.homeId) {
        if (c.food <= 0) return false;
        c.food -= 1;
        c.needs.hunger = clamp(c.needs.hunger - NEEDS.mealAtHome, 0, 100);
        return true;
      }
      if (!buyRetail(world, c, target, 'meal')) {
        remember(world, c, `Could not buy a meal at ${buildingLabel(target)}`, -2);
        return false;
      }
      c.needs.hunger = clamp(c.needs.hunger - NEEDS.mealAtShop, 0, 100);
      return true;
    }
    case 'shop': {
      if (!target) return false;
      let bought = 0;
      if (c.homeId !== null) {
        const affordable = Math.floor((c.money - SPENDING_RESERVE) / itemPrice('grocery', target));
        const qty = Math.min(GROCERY_TARGET - c.food, affordable, Math.floor(target.stock));
        if (qty > 0 && buyRetail(world, c, target, 'grocery', qty)) {
          c.food += qty;
          bought += qty;
        }
      }
      if (c.money > LUXURY_MIN_MONEY && c.traits.frugality < 0.7) {
        // Wealthier citizens buy more: one treat plus one per 250 cr of savings above the threshold.
        const want = Math.min(3, 1 + Math.floor((c.money - LUXURY_MIN_MONEY) / 250));
        const affordable = Math.floor((c.money - LUXURY_MIN_MONEY) / itemPrice('luxury', target)) + 1;
        const qty = Math.min(want, affordable, Math.floor(target.stock));
        if (qty > 0 && buyRetail(world, c, target, 'luxury', qty)) {
          c.socialBuff = Math.min(15, c.socialBuff + 6);
          remember(world, c, `Treated themself at ${buildingLabel(target)}`, 3);
          bought += qty;
        }
      }
      return bought > 0;
    }
    case 'seekJob':
      return seekJob(world, c, target);
    case 'seekCare': {
      if (!target || !isOperational(target)) return false;
      // Care is free for those who cannot pay.
      if (c.money >= PRICES.clinicVisit) transfer(world, citizenAcct(c), TREASURY, PRICES.clinicVisit, 'clinic.fees');
      return true;
    }
    case 'rest':
    case 'socialize':
    case 'protest':
      return !target || target.status === 'operational' || target.type === 'cityHall';
    case 'wait':
      return true;
  }
}

function seekJob(world: World, c: Citizen, target: Building | undefined): boolean {
  if (c.jobId !== null) return false;
  let job: Building | undefined;
  if (target && target.type === 'cityHall') job = bestOpenJob(world, c);
  else if (target && openJobs(world, target) > 0) job = target;
  else job = bestOpenJob(world, c);
  if (job && hire(world, c, job)) return true;
  // Nothing available: wait until tomorrow morning before searching again.
  const nextMorning = (Math.floor(world.tick / TICKS_PER_DAY) + 1) * TICKS_PER_DAY + WORK.startHour * TICKS_PER_HOUR;
  c.jobSearchCooldownUntil = nextMorning;
  remember(world, c, 'Searched for work but found no openings', -6);
  return true;
}

/** Advance a citizen's current activity by one tick. */
export function stepActivity(world: World, c: Citizen, blocked: Uint8Array): void {
  const a = c.activity;
  if (a.kind === 'idle') {
    if (a.wait > 0) a.wait -= 1;
    return;
  }
  if (a.kind === 'traveling') {
    stepTravel(world, c, blocked);
    return;
  }
  const target = getBuilding(world, a.targetId);
  if (a.targetId !== null && !target) {
    goIdle(c);
    return;
  }
  a.elapsed += 1;
  if (!performTick(world, c, a.action, target) || a.elapsed >= a.maxTicks) goIdle(c);
}

function stepTravel(world: World, c: Citizen, blocked: Uint8Array): void {
  const a = c.activity;
  if (a.kind !== 'traveling') return;
  a.ticksTraveled += 1;
  if (a.ticksTraveled > GUARDS.maxTravelTicks) {
    remember(world, c, 'Gave up on a trip that was taking too long', -2);
    goIdle(c, GUARDS.noOptionWait);
    return;
  }
  const target = getBuilding(world, a.targetId);
  if (a.targetId !== null && !target) {
    goIdle(c);
    return;
  }
  // The target's entrance may have moved after roads or buildings changed.
  if (target && !samePoint(target.entrance, a.destination)) {
    a.destination = { ...target.entrance };
    const repath = findPath(world, c.pos, a.destination);
    if (!repath) {
      goIdle(c, GUARDS.noOptionWait);
      return;
    }
    a.path = repath;
  }
  c.stepElapsed += 1;
  if (c.stepElapsed < c.stepTicks) return;
  if (a.path.length === 0) {
    c.prevPos = { ...c.pos };
    beginPerforming(world, c, a.action, a.targetId);
    return;
  }
  let next = a.path[0];
  if (blocked[tileIndex(world, next.x, next.y)]) {
    const repath = findPath(world, c.pos, a.destination);
    if (!repath || repath.length === 0) {
      goIdle(c, GUARDS.noOptionWait);
      return;
    }
    a.path = repath;
    next = a.path[0];
  }
  a.path.shift();
  c.prevPos = { ...c.pos };
  c.pos = { x: next.x, y: next.y };
  c.stepTicks = stepCost(world, next.x, next.y);
  c.stepElapsed = 0;
}

/** Per-tick effects of performing an action. Returns false to end the activity early. */
function performTick(world: World, c: Citizen, action: ActionKind, target: Building | undefined): boolean {
  const n = c.needs;
  switch (action) {
    case 'work': {
      if (!target || target.id !== c.jobId || !isOperational(target)) return false;
      payWage(world, c, target);
      c.workedToday += 1;
      produce(world, target);
      return n.hunger <= 80 && n.energy >= 12 && c.workedToday < WORK.shiftTicks;
    }
    case 'rest': {
      n.energy = clamp(n.energy + restRate(world, c), 0, 100);
      if (n.hunger > 85 || n.energy >= 98) return false;
      // A night's sleep ends at dawn once the citizen is reasonably rested.
      const overnight = c.activity.kind === 'performing' && c.activity.maxTicks > 3 * TICKS_PER_HOUR;
      return !(overnight && !isNight(world.tick) && n.energy >= 80);
    }
    case 'socialize':
      c.socialBuff = Math.min(15, c.socialBuff + NEEDS.socialBuffGain);
      return n.energy > 10 && n.hunger < 85;
    case 'seekCare':
      if (!target || !isOperational(target) || employeesOf(world, target.id).length === 0) return false;
      n.health = clamp(n.health + NEEDS.clinicHealing, 0, 100);
      return n.health < 92;
    case 'protest':
      c.socialBuff = Math.min(15, c.socialBuff + NEEDS.socialBuffGain * 0.3);
      return !!world.eventState.flags.protest;
    case 'eat':
    case 'shop':
    case 'seekJob':
    case 'wait':
      return true;
  }
}

function produce(world: World, b: Building): void {
  if (b.type === 'office') {
    transfer(world, EXTERNAL, { kind: 'building', building: b }, ECONOMY.officeRevenuePerWorkTick, 'contracts');
    b.today.revenue = roundMoney(b.today.revenue + ECONOMY.officeRevenuePerWorkTick);
  } else if (b.type === 'factory') {
    b.stock = Math.min(ECONOMY.factoryMaxStock, roundMoney(b.stock + ECONOMY.factoryOutputPerWorkTick));
  }
}

/** Groups socializing citizens by venue and strengthens their bonds. */
export function socialInteractions(world: World): void {
  const venues = new Map<number, Citizen[]>();
  for (const c of world.citizens) {
    const a = c.activity;
    if (a.kind !== 'performing' || (a.action !== 'socialize' && a.action !== 'protest') || a.targetId === null) continue;
    const list = venues.get(a.targetId) ?? [];
    list.push(c);
    venues.set(a.targetId, list);
  }
  for (const group of venues.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        const compat = (a.traits.sociability + b.traits.sociability) / 2;
        adjustRelationship(world, a, b, 0.35 * compat * compatibility(a, b));
      }
    }
  }
}

/** Move citizens off tiles that just became covered by a building. */
export function evictFromBlockedTiles(world: World): void {
  const blocked = blockedGrid(world);
  for (const c of world.citizens) {
    if (!blocked[tileIndex(world, c.pos.x, c.pos.y)]) continue;
    const b = world.buildings.find((x) => c.pos.x >= x.x && c.pos.x < x.x + x.w && c.pos.y >= x.y && c.pos.y < x.y + x.h);
    if (b) {
      c.pos = { ...b.entrance };
      c.prevPos = { ...b.entrance };
    }
    c.stepElapsed = c.stepTicks;
    if (c.activity.kind === 'traveling') goIdle(c);
  }
}
