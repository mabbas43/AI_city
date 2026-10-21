// Utility-based action selection. Each idle citizen scores every feasible
// (action, target) pair from its needs, personality, goals, money, the time of
// day, travel time and the people it knows, then commits to the best one.

import { BUILDING_DEFS, buildingLabel, canSell, employeesOf, getBuilding, isOperational, isRetail } from './buildings';
import { bestOpenJob, friendsOf, hasGoal } from './citizens';
import { PRICES, TICKS_PER_DAY, WORK } from './constants';
import { itemPrice } from './economy';
import { travelTime, type DistanceField } from './navigation';
import { random } from './rng';
import { activeEffect } from './effects';
import { hourOf, isNight, isWeekend } from './time';
import { WEATHER } from './weather';
import type { ActionKind, Building, Citizen, DecisionRecord, Point, World } from './types';

export interface Candidate {
  action: ActionKind;
  target: Building | null;
  destination: Point;
  travel: number;
  score: number;
  reasons: string[];
}

export const TRAVEL_PENALTY_PER_TICK = 0.004;
const NOISE = 0.06;

function fmt(n: number): string {
  return n.toFixed(0);
}

interface Draft {
  action: ActionKind;
  target: Building | null;
  base: number;
  reasons: string[];
}

function workDrafts(world: World, c: Citizen): Draft[] {
  const job = getBuilding(world, c.jobId);
  if (!job) return [];
  const h = hourOf(world.tick);
  if (h < WORK.startHour || h >= WORK.endHour || c.workedToday >= WORK.shiftTicks) return [];
  if (!isOperational(job)) return [];
  if (isWeekend(world.tick) && BUILDING_DEFS[job.type].closedOnWeekends) return [];
  const reasons = ['Within work hours', `Diligence ${c.traits.diligence.toFixed(2)}`];
  let base = 0.55 + 0.35 * c.traits.diligence;
  if (c.money < 60) {
    base += 0.2;
    reasons.push(`Low savings (${fmt(c.money)} cr)`);
  }
  if (hasGoal(c, 'saveMoney')) {
    base += 0.1;
    reasons.push('Saving money');
  }
  if (c.needs.energy < 20) {
    base -= 0.5;
    reasons.push('Too tired to work well');
  }
  if (c.needs.hunger > 75) {
    base -= 0.4;
    reasons.push('Too hungry to focus');
  }
  return [{ action: 'work', target: job, base, reasons }];
}

function nearestOf(field: DistanceField, buildings: Building[]): Building | undefined {
  let best: Building | undefined;
  let bestT = Infinity;
  for (const b of buildings) {
    const t = travelTime(field, b.entrance);
    if (t < bestT) {
      bestT = t;
      best = b;
    }
  }
  return best;
}

function restDrafts(world: World, c: Citizen, field: DistanceField): Draft[] {
  if (c.needs.energy > 92) return [];
  const fatigue = (100 - c.needs.energy) / 100;
  let base = Math.pow(fatigue, 1.5) * 1.3;
  const reasons = [`Energy ${fmt(c.needs.energy)}`];
  if (isNight(world.tick)) {
    base += 0.5;
    reasons.push('Night time');
  }
  const home = getBuilding(world, c.homeId);
  if (home) {
    if (!home.powered) reasons.push('Home has no power');
    return [{ action: 'rest', target: home, base, reasons }];
  }
  reasons.push('No home: resting outdoors');
  const park = nearestOf(field, world.buildings.filter((b) => b.type === 'park' && b.status === 'operational'));
  return [{ action: 'rest', target: park ?? null, base: base - 0.1, reasons }];
}

function eatDrafts(world: World, c: Citizen): Draft[] {
  if (c.needs.hunger < 25) return [];
  const h = c.needs.hunger / 100;
  const base = h * h * 1.8 + (c.needs.hunger > 70 ? 0.3 : 0);
  const out: Draft[] = [];
  const home = getBuilding(world, c.homeId);
  if (home && c.food > 0) {
    out.push({ action: 'eat', target: home, base: base + 0.05 * c.traits.frugality, reasons: [`Hunger ${fmt(c.needs.hunger)}`, `${c.food} groceries at home`] });
  }
  for (const b of world.buildings) {
    const price = itemPrice('meal', b);
    if (!canSell(world, b) || c.money < price) continue;
    const thrift = (c.traits.frugality * 0.4 + (hasGoal(c, 'saveMoney') ? 0.1 : 0)) * (price / PRICES.meal);
    out.push({ action: 'eat', target: b, base: base - thrift, reasons: [`Hunger ${fmt(c.needs.hunger)}`, `Meal costs ${price} cr`] });
  }
  return out;
}

export const GROCERY_TARGET = 4;
export const SPENDING_RESERVE = 10;
export const LUXURY_MIN_MONEY = 150;

function shopDrafts(world: World, c: Citizen): Draft[] {
  const wantsGroceries = c.food < 3 && c.money >= PRICES.grocery * 2 + SPENDING_RESERVE && c.homeId !== null;
  const wantsLuxury = c.money > LUXURY_MIN_MONEY && c.traits.frugality < 0.7;
  if (!wantsGroceries && !wantsLuxury) return [];
  let base = 0;
  const reasons: string[] = [];
  if (wantsGroceries) {
    base += 0.3 + (3 - c.food) * 0.12 + (c.needs.hunger > 45 ? 0.15 : 0);
    reasons.push(`Only ${c.food} groceries left`);
  }
  if (wantsLuxury) {
    // The more savings pile up, the more tempting it is to spend them.
    base += 0.15 + (100 - c.needs.happiness) / 250 + Math.min(0.5, (c.money - LUXURY_MIN_MONEY) / 500);
    reasons.push(`Can afford a treat (${fmt(c.money)} cr)`);
  }
  if (isWeekend(world.tick)) {
    base += 0.1;
    reasons.push('Weekend shopping');
  }
  return world.buildings
    .filter((b) => canSell(world, b))
    .map((b) => {
      const factor = BUILDING_DEFS[b.type].priceFactor;
      const r = factor < 1 ? [...reasons, `${Math.round((1 - factor) * 100)}% cheaper here`] : reasons;
      return { action: 'shop' as const, target: b, base: base - c.traits.frugality * 0.4 * factor, reasons: r };
    });
}

function socializeDrafts(world: World, c: Citizen): Draft[] {
  const night = isNight(world.tick);
  const h = hourOf(world.tick);
  let base = 0.25 + c.traits.sociability * 0.5 + (100 - c.needs.happiness) / 250;
  const reasons = [`Sociability ${c.traits.sociability.toFixed(2)}`];
  if (hasGoal(c, 'makeFriends')) {
    base += 0.2;
    reasons.push('Wants new friends');
  }
  if (h >= 17 && h < 22) {
    base += 0.25;
    reasons.push('Evening');
  }
  if (night) base -= 0.5;
  if (isWeekend(world.tick) && !night) {
    base += 0.2;
    reasons.push('Weekend');
  }
  base -= Math.min(1, c.socialBuff / 15) * 0.45;
  const weather = WEATHER[world.weather.kind];
  const festival = activeEffect(world, 'festival');
  if (c.needs.energy < 25) base -= 0.4;

  const friends = friendsOf(world, c);
  const out: Draft[] = [];
  for (const b of world.buildings) {
    const venue = b.type === 'park' || b.type === 'cityHall' || isRetail(b);
    if (!venue || !isOperational(b)) continue;
    const friendsThere = friends.filter((f) => f.insideId === b.id && f.activity.kind === 'performing' && f.activity.action === 'socialize').length;
    let s = base + Math.min(0.3, friendsThere * 0.1);
    if (b.type === 'cityHall') s -= 0.1;
    if (isRetail(b)) s -= 0.12;
    const r = friendsThere > 0 ? [...reasons, `${friendsThere} friend${friendsThere > 1 ? 's' : ''} there`] : [...reasons];
    const outdoors = b.type === 'park' || b.type === 'cityHall';
    if (outdoors && weather.outdoor !== 0) {
      s += weather.outdoor;
      r.push(weather.outdoor > 0 ? `${weather.label}: nice outside` : `${weather.label}: unpleasant outside`);
    }
    if (outdoors && festival) {
      s += 0.4;
      r.push(festival.label);
    }
    out.push({ action: 'socialize', target: b, base: s, reasons: r });
  }
  return out;
}

function seekJobDrafts(world: World, c: Citizen): Draft[] {
  if (c.jobId !== null || world.tick < c.jobSearchCooldownUntil) return [];
  const h = hourOf(world.tick);
  if (h < 7 || h >= 18) return [];
  const days = c.ticksUnemployed / TICKS_PER_DAY;
  let base = 0.75 + Math.min(0.4, days * 0.15);
  const reasons = ['Unemployed'];
  if (hasGoal(c, 'findJob')) {
    base += 0.2;
    reasons.push('Goal: find work');
  }
  if (c.money < 50) {
    base += 0.2;
    reasons.push('Running out of money');
  }
  const hall = world.buildings.find((b) => b.type === 'cityHall' && isOperational(b));
  if (hall) return [{ action: 'seekJob', target: hall, base, reasons: [...reasons, 'Job center at City Hall'] }];
  const direct = bestOpenJob(world, c);
  if (direct) return [{ action: 'seekJob', target: direct, base, reasons: [...reasons, `Opening at ${buildingLabel(direct)}`] }];
  return [];
}

function seekCareDrafts(world: World, c: Citizen): Draft[] {
  if (c.needs.health >= 60) return [];
  const base = ((60 - c.needs.health) / 60) * 1.6 + 0.2;
  return world.buildings
    .filter((b) => b.type === 'clinic' && isOperational(b) && employeesOf(world, b.id).length > 0)
    .map((b) => ({ action: 'seekCare' as const, target: b, base, reasons: [`Health ${fmt(c.needs.health)}`] }));
}

function protestDrafts(world: World, c: Citizen): Draft[] {
  if (!world.eventState.flags.protest || c.needs.happiness >= 40) return [];
  const hall = world.buildings.find((b) => b.type === 'cityHall');
  if (!hall) return [];
  let base = 0.6 + ((40 - c.needs.happiness) / 40) * 0.6;
  if (isNight(world.tick)) base -= 0.6;
  return [{ action: 'protest', target: hall, base, reasons: [`Unhappy (${fmt(c.needs.happiness)})`, 'Protest under way at City Hall'] }];
}

export function generateCandidates(world: World, c: Citizen, field: DistanceField): Candidate[] {
  const drafts: Draft[] = [
    ...workDrafts(world, c),
    ...restDrafts(world, c, field),
    ...eatDrafts(world, c),
    ...shopDrafts(world, c),
    ...socializeDrafts(world, c),
    ...seekJobDrafts(world, c),
    ...seekCareDrafts(world, c),
    ...protestDrafts(world, c),
    { action: 'wait', target: null, base: 0.08, reasons: ['Nothing better to do'] },
  ];
  const out: Candidate[] = [];
  for (const d of drafts) {
    const destination = d.target ? d.target.entrance : c.pos;
    const travel = travelTime(field, destination);
    if (!Number.isFinite(travel)) continue; // unreachable targets are never chosen
    const score = d.base - travel * TRAVEL_PENALTY_PER_TICK + random(world) * NOISE;
    const reasons = travel > 0 ? [...d.reasons, `${travel} ticks away`] : d.reasons;
    out.push({ action: d.action, target: d.target, destination, travel, score, reasons });
  }
  return out;
}

export function chooseAction(world: World, c: Citizen, field: DistanceField): Candidate {
  const candidates = generateCandidates(world, c, field);
  // 'wait' at the current position is always reachable, so there is always a candidate.
  let best = candidates[0];
  for (const cand of candidates) if (cand.score > best.score) best = cand;

  const bestPerAction = new Map<ActionKind, Candidate>();
  for (const cand of candidates) {
    if (cand === best) continue;
    const prev = bestPerAction.get(cand.action);
    if (!prev || cand.score > prev.score) bestPerAction.set(cand.action, cand);
  }
  const record: DecisionRecord = {
    tick: world.tick,
    action: best.action,
    targetId: best.target?.id ?? null,
    score: round3(best.score),
    reasons: best.reasons,
    alternatives: [...bestPerAction.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((a) => ({ action: a.action, targetId: a.target?.id ?? null, score: round3(a.score) })),
  };
  c.lastDecision = record;
  return best;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

export const ACTION_LABELS: Record<ActionKind, string> = {
  work: 'Working',
  rest: 'Resting',
  eat: 'Eating',
  shop: 'Shopping',
  socialize: 'Socializing',
  seekJob: 'Job hunting',
  seekCare: 'At the clinic',
  protest: 'Protesting',
  wait: 'Idling',
};

export function describeTarget(world: World, id: number | null): string {
  const b = getBuilding(world, id);
  return b ? BUILDING_DEFS[b.type].label : 'here';
}
