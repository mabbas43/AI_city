// Mayor approval and elections. Approval drifts towards an itemised target
// built from the city's condition, so the player can always see why it moved.
// Every TERM_DAYS days an election is held; losing ends the game.

import { employeesOf } from './buildings';
import { clamp } from './citizens';
import { TICKS_PER_DAY } from './constants';
import { EXTERNAL, TREASURY, transfer } from './economy';
import { pushEvent } from './events';
import { cityStats, pct } from './stats';
import type { Difficulty, HappinessFactor, World } from './types';

export const TERM_DAYS = 7;
export const APPROVAL_DRIFT = 0.12;

export const DIFFICULTY: Record<Difficulty, { label: string; treasury: number; reelection: number; description: string }> = {
  relaxed: { label: 'Relaxed', treasury: 9000, reelection: 30, description: '9,000 cr to start · re-election needs 30% approval' },
  standard: { label: 'Standard', treasury: 6000, reelection: 40, description: '6,000 cr to start · re-election needs 40% approval' },
  hard: { label: 'Hard', treasury: 3500, reelection: 50, description: '3,500 cr to start · re-election needs 50% approval' },
};

export function reelectionThreshold(world: World): number {
  return DIFFICULTY[world.difficulty].reelection;
}

/** Re-election grant from the regional government, scaled by city size. */
export function electionGrant(world: World): number {
  return 500 + world.citizens.length * 25;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

export function approvalFactors(world: World): HappinessFactor[] {
  const s = cityStats(world);
  const f: HappinessFactor[] = [{ label: 'Baseline', value: 50 }];
  if (s.population > 0) f.push({ label: `Citizen mood (${Math.round(s.avgHappiness)})`, value: (s.avgHappiness - 60) * 0.9 });
  if (s.unemploymentRate > 0.05) f.push({ label: `Unemployment ${pct(s.unemploymentRate)}`, value: -(s.unemploymentRate - 0.05) * 70 });
  if (s.homeless > 0) f.push({ label: `${s.homeless} homeless`, value: -Math.min(15, s.homeless * 3) });
  if (world.eventState.flags.powerShortage) f.push({ label: 'Blackouts', value: -8 });
  if (s.closedBusinesses > 0) f.push({ label: `${s.closedBusinesses} closed business${s.closedBusinesses > 1 ? 'es' : ''}`, value: -Math.min(9, s.closedBusinesses * 3) });
  if (world.eventState.flags.protest) f.push({ label: 'Protest at City Hall', value: -10 });
  if (world.eventState.flags.budgetCrisis) f.push({ label: 'Budget crisis', value: -6 });
  const p = world.policies;
  if (p.incomeTaxRate > 0.15) f.push({ label: 'High income tax', value: -(p.incomeTaxRate - 0.15) * 60 });
  else if (p.incomeTaxRate < 0.1) f.push({ label: 'Low income tax', value: (0.1 - p.incomeTaxRate) * 30 });
  if (p.salesTaxRate > 0.1) f.push({ label: 'High sales tax', value: -(p.salesTaxRate - 0.1) * 40 });
  if (p.unemploymentBenefit >= 15 && s.unemployed > 0) f.push({ label: 'Generous benefits', value: 2 });
  const clinic = world.buildings.some((b) => b.type === 'clinic' && b.status === 'operational' && b.powered && employeesOf(world, b.id).length > 0);
  if (clinic) f.push({ label: 'Working clinic', value: 2 });
  else f.push({ label: 'No working clinic', value: -5 });
  const parks = world.buildings.filter((b) => b.type === 'park' && b.status === 'operational').length;
  if (s.population > 0 && parks * 15 >= s.population) f.push({ label: 'Plenty of parks', value: 2 });
  if (world.buildings.some((b) => b.type === 'school' && b.status === 'operational')) f.push({ label: 'Public school', value: 2 });
  for (const m of world.approval.modifiers) f.push({ label: m.label, value: m.value });
  return f.map((x) => ({ label: x.label, value: round1(x.value) }));
}

export function targetApproval(factors: HappinessFactor[]): number {
  return clamp(factors.reduce((s, x) => s + x.value, 0), 0, 100);
}

/** Hourly: refresh the breakdown and move approval part of the way to its target. */
export function updateApproval(world: World): void {
  const factors = approvalFactors(world);
  const target = targetApproval(factors);
  world.approval.factors = factors;
  world.approval.value = round1(clamp(world.approval.value + (target - world.approval.value) * APPROVAL_DRIFT, 0, 100));
}

export function initApproval(world: World): void {
  world.approval.factors = approvalFactors(world);
  world.approval.value = round1(targetApproval(world.approval.factors));
}

export function daysUntilElection(world: World): number {
  return Math.max(0, (world.election.nextTick - world.tick) / TICKS_PER_DAY);
}

/** Checked at the start of each day. */
export function checkElection(world: World): void {
  if (world.sandbox || world.gameOver || world.tick < world.election.nextTick) return;
  const approval = world.approval.value;
  const needed = reelectionThreshold(world);
  const won = approval >= needed;
  world.election.history.push({ tick: world.tick, approval, won });
  world.election.nextTick += TERM_DAYS * TICKS_PER_DAY;
  const worst = [...world.approval.factors].filter((f) => f.value < 0).sort((a, b) => a.value - b.value).slice(0, 3);
  const best = [...world.approval.factors].filter((f) => f.value > 0 && f.label !== 'Baseline').sort((a, b) => b.value - a.value).slice(0, 3);
  const causes = [`Approval ${approval.toFixed(0)}% vs ${needed}% needed`, ...(won ? best : worst).map((f) => `${f.label} (${f.value > 0 ? '+' : ''}${f.value})`)];
  if (won) {
    world.election.term += 1;
    const grant = electionGrant(world);
    transfer(world, EXTERNAL, TREASURY, grant, 'grants');
    pushEvent(world, {
      type: 'election',
      severity: 'info',
      title: `Re-elected for term ${world.election.term}`,
      description: `Voters returned you to City Hall. The regional government awarded a ${grant} cr development grant.`,
      causes,
    });
  } else {
    world.gameOver = { tick: world.tick, reason: `Voted out with ${approval.toFixed(0)}% approval (needed ${needed}%)` };
    pushEvent(world, {
      type: 'election',
      severity: 'critical',
      title: 'Voted out of office',
      description: 'The citizens chose a new mayor.',
      causes,
    });
  }
}

