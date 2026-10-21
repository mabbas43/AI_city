// Petitions: decisions put to the mayor when the city reaches specific
// conditions. Each option has a clear cost and consequence; a petition left
// unanswered resolves to its default option when it expires.

import { BUILDING_DEFS, buildingLabel, getBuilding } from './buildings';
import { TICKS_PER_DAY, TICKS_PER_HOUR, START_TICK } from './constants';
import type { CommandResult } from './construction';
import { TREASURY, transfer } from './economy';
import { activeEffect, addApprovalModifier, addEffect } from './effects';
import { neighbourhood } from './environment';
import { pushEvent } from './events';
import { setPolicy } from './policies';
import { cityStats, pct } from './stats';
import { hourOf, isWeekend } from './time';
import { WEATHER } from './weather';
import type { Petition, PetitionKind, PetitionOption, World } from './types';

export const MAX_OPEN_PETITIONS = 2;
/** No petitions during the first hours of a new city. */
export const PETITION_GRACE_TICKS = START_TICK + 4 * TICKS_PER_HOUR;

export const COSTS = { bailout: 400, powerImport: 250, festival: 300, cooling: 150 };
export const IMPORT_POWER = 25;

const SHORTAGE_HOURS = 'shortageHours';

interface Draft {
  kind: PetitionKind;
  title: string;
  description: string;
  causes: string[];
  options: PetitionOption[];
  defaultOption: string;
  hours: number;
  buildingId?: number;
  cooldownKey: string;
}

function cooledDown(world: World, key: string, ticks: number): boolean {
  const last = world.eventState.lastFired[key];
  return last === undefined || world.tick - last >= ticks;
}

function hasOpen(world: World, kind: PetitionKind, buildingId: number | null = null): boolean {
  return world.petitions.some((p) => p.kind === kind && (buildingId === null || p.buildingId === buildingId));
}

function bailoutDrafts(world: World): Draft[] {
  const out: Draft[] = [];
  for (const b of world.buildings) {
    const d = BUILDING_DEFS[b.type];
    if (d.isPublic || d.jobs === 0 || b.status !== 'operational' || b.distressHours < 3) continue;
    const key = `petition:bailout:${b.id}`;
    if (hasOpen(world, 'bailout', b.id) || !cooledDown(world, key, TICKS_PER_DAY)) continue;
    const staff = world.citizens.filter((c) => c.jobId === b.id).length;
    out.push({
      kind: 'bailout',
      title: `${buildingLabel(b)} asks for a bailout`,
      description: `The owners cannot cover payroll. Without help the business closes in ${12 - b.distressHours} hours and ${staff} people lose their jobs.`,
      causes: [`Cash ${b.funds.toFixed(0)} cr is below one hour of payroll`, `Distressed for ${b.distressHours} hours`, `Revenue today ${b.today.revenue.toFixed(0)} cr`],
      options: [
        { id: 'fund', label: `Bail out (${COSTS.bailout} cr)`, detail: `Pays ${COSTS.bailout} cr into the business. Workers are grateful (+3 approval for a day).`, cost: COSTS.bailout },
        { id: 'refuse', label: 'Let the market decide', detail: 'No cost now. The business will probably close.', cost: 0 },
      ],
      defaultOption: 'refuse',
      hours: 6,
      buildingId: b.id,
      cooldownKey: key,
    });
  }
  return out;
}

function powerDraft(world: World): Draft | null {
  const hours = world.eventState.streaks[SHORTAGE_HOURS] ?? 0;
  if (hours < 2 || activeEffect(world, 'powerImport') || hasOpen(world, 'powerImport')) return null;
  if (!cooledDown(world, 'petition:powerImport', 12 * TICKS_PER_HOUR)) return null;
  return {
    kind: 'powerImport',
    title: 'Regional grid offers emergency power',
    description: `The neighbouring grid can supply ${IMPORT_POWER} power units for the next 24 hours.`,
    causes: [`Power shortage for ${hours} hours`, `Demand ${world.power.demand} vs supply ${world.power.supply}`, `${world.power.unpoweredIds.length} buildings dark`],
    options: [
      { id: 'buy', label: `Buy power (${COSTS.powerImport} cr)`, detail: `+${IMPORT_POWER} supply for 24 hours. Gives you time to build generation.`, cost: COSTS.powerImport },
      { id: 'decline', label: 'Decline', detail: 'Blackouts continue until you add generation or cut demand.', cost: 0 },
    ],
    defaultOption: 'decline',
    hours: 4,
    cooldownKey: 'petition:powerImport',
  };
}

function festivalDraft(world: World): Draft | null {
  const h = hourOf(world.tick);
  if (!isWeekend(world.tick) || h < 9 || h >= 13 || hasOpen(world, 'festival')) return null;
  const s = cityStats(world);
  if (s.population < 10 || s.avgHappiness < 45 || world.weather.kind === 'storm') return null;
  if (!cooledDown(world, 'petition:festival', 5 * TICKS_PER_DAY)) return null;
  return {
    kind: 'festival',
    title: 'Residents propose a street festival',
    description: 'A neighbourhood committee wants the city to sponsor a festival in the parks and plaza this afternoon and evening.',
    causes: ['It is the weekend', `Average happiness ${s.avgHappiness.toFixed(0)}`, `Weather: ${WEATHER[world.weather.kind].label.toLowerCase()}`],
    options: [
      { id: 'host', label: `Sponsor it (${COSTS.festival} cr)`, detail: 'Everyone gets +6 mood until 23:00, crowds gather outdoors, +4 approval for two days.', cost: COSTS.festival },
      { id: 'skip', label: 'Not this time', detail: 'No cost, no effect.', cost: 0 },
    ],
    defaultOption: 'skip',
    hours: 3,
    cooldownKey: 'petition:festival',
  };
}

function taxDraft(world: World): Draft | null {
  const s = cityStats(world);
  const tax = world.policies.incomeTaxRate;
  if (tax <= 0.18 || s.population < 10 || s.avgHappiness >= 60 || hasOpen(world, 'taxRelief')) return null;
  if (!cooledDown(world, 'petition:taxRelief', 3 * TICKS_PER_DAY)) return null;
  return {
    kind: 'taxRelief',
    title: 'Workers petition for tax relief',
    description: `A petition signed by ${Math.round(s.employed * 0.6)} workers demands the income tax be cut back to 15%.`,
    causes: [`Income tax is ${pct(tax)}`, `Average happiness ${s.avgHappiness.toFixed(0)}`],
    options: [
      { id: 'cut', label: 'Cut income tax to 15%', detail: 'Less tax revenue. +5 approval for two days.', cost: 0 },
      { id: 'refuse', label: 'Keep current rate', detail: '−5 approval for two days.', cost: 0 },
    ],
    defaultOption: 'refuse',
    hours: 12,
    cooldownKey: 'petition:taxRelief',
  };
}

function coolingDraft(world: World): Draft | null {
  if (world.weather.kind !== 'heatwave' || activeEffect(world, 'coolingCenters') || hasOpen(world, 'cooling')) return null;
  if (!cooledDown(world, 'petition:cooling', 12 * TICKS_PER_HOUR)) return null;
  const hours = Math.ceil((world.weather.untilTick - world.tick) / TICKS_PER_HOUR);
  if (hours < 3) return null;
  return {
    kind: 'cooling',
    title: 'Clinic urges cooling centers',
    description: `The heatwave will last about ${hours} more hours. Medics ask the city to open air-conditioned public cooling centers.`,
    causes: ['Heatwave in progress', 'Citizens away from a powered home lose health in the heat'],
    options: [
      { id: 'open', label: `Open centers (${COSTS.cooling} cr)`, detail: 'No heat health loss or heatwave mood penalty until it ends.', cost: COSTS.cooling },
      { id: 'ignore', label: 'Ignore', detail: 'Health suffers. −3 approval for a day.', cost: 0 },
    ],
    defaultOption: 'ignore',
    hours: 3,
    cooldownKey: 'petition:cooling',
  };
}

function parkDraft(world: World): Draft | null {
  if (activeEffect(world, 'parkPromise') || hasOpen(world, 'parkRequest')) return null;
  if (!cooledDown(world, 'petition:parkRequest', 4 * TICKS_PER_DAY)) return null;
  const housed = world.citizens.filter((c) => c.homeId !== null);
  if (housed.length < 12) return null;
  const parkByHome = new Map<number, boolean>();
  let without = 0;
  for (const c of housed) {
    if (!parkByHome.has(c.homeId!)) parkByHome.set(c.homeId!, neighbourhood(world, getBuilding(world, c.homeId)!).park);
    if (!parkByHome.get(c.homeId!)) without += 1;
  }
  const share = without / housed.length;
  if (share < 0.4) return null;
  return {
    kind: 'parkRequest',
    title: 'Residents ask for a new park',
    description: `${without} residents live more than 10 blocks from a park and want one closer to home.`,
    causes: [`${pct(share)} of housed citizens have no park nearby`],
    options: [
      { id: 'promise', label: 'Promise a park within 3 days', detail: 'Build a new park in time for +6 approval for two days; break the promise for −8.', cost: 0 },
      { id: 'decline', label: 'Decline', detail: '−3 approval for two days.', cost: 0 },
    ],
    defaultOption: 'decline',
    hours: 12,
    cooldownKey: 'petition:parkRequest',
  };
}

function open(world: World, d: Draft): Petition {
  const p: Petition = {
    id: world.nextPetitionId++,
    kind: d.kind,
    tick: world.tick,
    expiresAt: world.tick + d.hours * TICKS_PER_HOUR,
    title: d.title,
    description: d.description,
    causes: d.causes,
    options: d.options,
    defaultOption: d.defaultOption,
    buildingId: d.buildingId ?? null,
  };
  world.petitions.push(p);
  world.eventState.lastFired[d.cooldownKey] = world.tick;
  pushEvent(world, {
    type: 'petition',
    severity: 'warning',
    title: `Decision needed: ${d.title}`,
    description: d.description,
    causes: d.causes,
    buildingIds: d.buildingId ? [d.buildingId] : [],
  });
  return p;
}

function hoursUntil(world: World, hour: number): number {
  return Math.max(1, hour - hourOf(world.tick));
}

function applyOption(world: World, p: Petition, optionId: string): string {
  const parks = () => world.buildings.filter((b) => b.type === 'park').length;
  switch (`${p.kind}:${optionId}`) {
    case 'bailout:fund': {
      const b = getBuilding(world, p.buildingId);
      if (!b) return 'The business no longer exists';
      transfer(world, TREASURY, { kind: 'building', building: b }, COSTS.bailout, 'subsidy');
      b.distressHours = 0;
      addApprovalModifier(world, `Rescued ${BUILDING_DEFS[b.type].label} jobs`, 3, 24);
      return `Paid ${COSTS.bailout} cr to ${buildingLabel(b)}`;
    }
    case 'powerImport:buy':
      transfer(world, TREASURY, { kind: 'external' }, COSTS.powerImport, 'power.imports');
      addEffect(world, 'powerImport', 'Imported power', 24, IMPORT_POWER);
      return `+${IMPORT_POWER} power for 24 hours`;
    case 'festival:host':
      transfer(world, TREASURY, { kind: 'external' }, COSTS.festival, 'events');
      addEffect(world, 'festival', 'City festival', hoursUntil(world, 23), 6);
      addApprovalModifier(world, 'Sponsored a festival', 4, 48);
      for (const c of world.citizens) c.socialBuff = Math.min(15, c.socialBuff + 4);
      pushEvent(world, {
        type: 'festival',
        severity: 'info',
        title: 'Street festival in the parks',
        description: 'Music and food stalls draw crowds to the parks and the City Hall plaza until 23:00.',
        causes: [`Sponsored by the city for ${COSTS.festival} cr`, '+6 mood for every citizen'],
      });
      return 'The festival is under way';
    case 'taxRelief:cut':
      setPolicy(world, 'incomeTaxRate', 0.15);
      addApprovalModifier(world, 'Cut taxes on request', 5, 48);
      return 'Income tax cut to 15%';
    case 'taxRelief:refuse':
      addApprovalModifier(world, 'Ignored tax petition', -5, 48);
      return 'Income tax unchanged';
    case 'cooling:open': {
      transfer(world, TREASURY, { kind: 'external' }, COSTS.cooling, 'events');
      const hours = Math.max(1, (world.weather.untilTick - world.tick) / TICKS_PER_HOUR);
      addEffect(world, 'coolingCenters', 'Cooling centers open', hours);
      return 'Cooling centers opened';
    }
    case 'cooling:ignore':
      addApprovalModifier(world, 'Ignored the heatwave', -3, 24);
      return 'No cooling centers';
    case 'parkRequest:promise':
      addEffect(world, 'parkPromise', 'Promised a park', 72, parks());
      return 'A park is promised within 3 days';
    case 'parkRequest:decline':
      addApprovalModifier(world, 'Refused a park', -3, 48);
      return 'No park planned';
    default:
      return 'No change';
  }
}

/** Player answers a petition. Validates the option and its cost first. */
export function resolvePetition(world: World, petitionId: number, optionId: string, auto = false): CommandResult {
  const p = world.petitions.find((x) => x.id === petitionId);
  if (!p) return { ok: false, reason: 'This petition has already been settled' };
  const option = p.options.find((o) => o.id === optionId);
  if (!option) return { ok: false, reason: 'Unknown option' };
  if (option.cost > world.treasury) return { ok: false, reason: `Needs ${option.cost} cr (treasury has ${Math.floor(world.treasury)})` };
  world.petitions = world.petitions.filter((x) => x.id !== p.id);
  const outcome = applyOption(world, p, option.id);
  pushEvent(world, {
    type: 'petition',
    severity: 'info',
    title: `${auto ? 'No response' : 'Decided'}: ${option.label}`,
    description: p.title,
    causes: [auto ? 'The petition expired without an answer; the default applied' : 'Decision by the mayor', outcome],
    buildingIds: p.buildingId ? [p.buildingId] : [],
  });
  return { ok: true };
}

/** Hourly: expire overdue petitions, follow up on promises and raise new petitions. */
export function updatePetitions(world: World): void {
  world.eventState.streaks[SHORTAGE_HOURS] = world.power.shortage ? (world.eventState.streaks[SHORTAGE_HOURS] ?? 0) + 1 : 0;
  for (const p of [...world.petitions]) if (world.tick >= p.expiresAt) resolvePetition(world, p.id, p.defaultOption, true);

  const promise = activeEffect(world, 'parkPromise');
  if (promise && world.buildings.filter((b) => b.type === 'park').length > promise.value) {
    world.effects = world.effects.filter((e) => e !== promise);
    addApprovalModifier(world, 'Kept park promise', 6, 48);
    pushEvent(world, { type: 'petition', severity: 'info', title: 'Promise kept: new park opened', description: 'Residents celebrate the new park.', causes: ['A park was built within the promised 3 days', '+6 approval for two days'] });
  }

  if (world.tick < PETITION_GRACE_TICKS || world.gameOver) return;
  const drafts = [...bailoutDrafts(world), powerDraft(world), coolingDraft(world), festivalDraft(world), taxDraft(world), parkDraft(world)].filter((d): d is Draft => d !== null);
  for (const d of drafts) {
    if (world.petitions.length >= MAX_OPEN_PETITIONS) break;
    open(world, d);
  }
}

/** Called for effects that ran out this hour. */
export function onEffectsEnded(world: World, ended: { kind: string }[]): void {
  for (const e of ended) {
    if (e.kind === 'parkPromise') {
      addApprovalModifier(world, 'Broke park promise', -8, 48);
      pushEvent(world, { type: 'petition', severity: 'warning', title: 'Promise broken: no new park', description: 'Residents feel misled.', causes: ['No park was built within 3 days of the promise', '−8 approval for two days'] });
    } else if (e.kind === 'powerImport') {
      pushEvent(world, { type: 'petition', severity: 'info', title: 'Power import contract ended', description: 'The regional grid stopped supplying extra power.', causes: [`−${IMPORT_POWER} supply`] });
    }
  }
}
