// City policies and player economic commands.

import { BUILDING_DEFS, buildingLabel, getBuilding } from './buildings';
import { ECONOMY } from './constants';
import type { CommandResult } from './construction';
import { TREASURY, transfer } from './economy';
import { pushEvent } from './events';
import type { Policies, World } from './types';

export const POLICY_LIMITS = {
  incomeTaxRate: { min: 0, max: 0.35, step: 0.01 },
  salesTaxRate: { min: 0, max: 0.2, step: 0.01 },
  unemploymentBenefit: { min: 0, max: 40, step: 1 },
} as const;

export const DEFAULT_POLICIES: Policies = {
  incomeTaxRate: 0.15,
  salesTaxRate: 0.08,
  unemploymentBenefit: 10,
  energyConservation: false,
};

const LABELS: Record<keyof Policies, string> = {
  incomeTaxRate: 'Income tax',
  salesTaxRate: 'Sales tax',
  unemploymentBenefit: 'Unemployment benefit',
  energyConservation: 'Energy conservation',
};

function formatPolicy(key: keyof Policies, value: number | boolean): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (key === 'unemploymentBenefit') return `${value} cr/day`;
  return `${Math.round(value * 100)}%`;
}

export function setPolicy<K extends keyof Policies>(world: World, key: K, value: Policies[K]): CommandResult {
  if (key === 'energyConservation') {
    if (typeof value !== 'boolean') return { ok: false, reason: 'Expected on/off' };
  } else {
    const lim = POLICY_LIMITS[key as keyof typeof POLICY_LIMITS];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < lim.min || value > lim.max) {
      return { ok: false, reason: `Must be between ${lim.min} and ${lim.max}` };
    }
  }
  const before = world.policies[key];
  if (before === value) return { ok: true };
  world.policies[key] = value;
  pushEvent(world, {
    type: 'policy',
    severity: 'info',
    title: `${LABELS[key]} set to ${formatPolicy(key, value)}`,
    description: 'City Hall changed policy.',
    causes: [`Changed from ${formatPolicy(key, before)} by the city government`],
  });
  return { ok: true };
}

/** Inject treasury cash into a business; reopens it if it had closed. */
export function subsidizeBuilding(world: World, buildingId: number, amount = ECONOMY.subsidyAmount): CommandResult {
  const b = getBuilding(world, buildingId);
  if (!b) return { ok: false, reason: 'Building not found' };
  const d = BUILDING_DEFS[b.type];
  if (d.isPublic || d.jobs === 0) return { ok: false, reason: 'Only businesses can be subsidized' };
  if (world.treasury < amount) return { ok: false, reason: `Needs ${amount} cr` };
  if (!transfer(world, TREASURY, { kind: 'building', building: b }, amount, 'subsidy')) return { ok: false, reason: 'Transfer failed' };
  const reopened = b.status === 'closed';
  b.status = 'operational';
  b.distressHours = 0;
  pushEvent(world, {
    type: reopened ? 'businessReopened' : 'policy',
    severity: 'info',
    title: reopened ? `${buildingLabel(b)} reopened` : `${buildingLabel(b)} subsidized`,
    description: reopened ? 'A city bailout allowed the business to reopen and hire again.' : 'The city injected cash into the business.',
    causes: [`Subsidy of ${amount} cr from the treasury`, `Funds now ${b.funds.toFixed(0)} cr`],
    buildingIds: [b.id],
  });
  return { ok: true, building: b };
}
