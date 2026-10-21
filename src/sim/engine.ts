// Tick orchestration. `stepWorld` advances the world by exactly one fixed
// timestep; it is deterministic given the world state (including RNG state).

import { goIdle, socialInteractions, startCandidate, stepActivity } from './activities';
import { checkElection, updateApproval } from './approval';
import { buildingLabel } from './buildings';
import { BULLETIN_HOUR, publishBulletin } from './bulletin';
import { layOff, remember, reviewWages, schoolLearning, updateGoals } from './citizens';
import { expireEffects } from './effects';
import { neighbourhood } from './environment';
import { SURPLUS_DAYS, checkMilestones } from './milestones';
import { onEffectsEnded, updatePetitions } from './petitions';
import { hourOf } from './time';
import { updateWeather } from './weather';
import { POPULATION, TICKS_PER_DAY, TICKS_PER_HOUR } from './constants';
import { chooseAction } from './decision';
import {
  chargeBusinessCosts,
  checkSolvency,
  collectRentAndBenefits,
  exportSurplus,
  payUpkeep,
  restockShops,
} from './economy';
import { detectHourlyEvents, detectPowerEvents, detectUnemploymentTrend, pushEvent } from './events';
import { blockedGrid } from './map';
import { distanceField, type DistanceField } from './navigation';
import { decayNeeds, driftHappiness, environmentHealth, happinessFactors } from './needs';
import { IMMIGRATION_INTERVAL, checkEmigration, checkImmigration } from './population';
import { updatePower } from './power';
import { recordSample } from './stats';
import type { World } from './types';

export function stepWorld(world: World): void {
  world.tick += 1;
  const hourStart = world.tick % TICKS_PER_HOUR === 0;
  const dayStart = world.tick % TICKS_PER_DAY === 0;

  updatePower(world);
  detectPowerEvents(world);

  const blocked = blockedGrid(world);
  for (const c of world.citizens) {
    decayNeeds(c);
    stepActivity(world, c, blocked);
    c.ticksUnemployed = c.jobId === null ? c.ticksUnemployed + 1 : 0;
    c.miseryTicks = c.needs.happiness < POPULATION.emigrationHappiness ? c.miseryTicks + 1 : 0;
  }
  // The map cannot change while citizens decide, so citizens standing on the
  // same tile (e.g. a shared front door) can share one distance field.
  const fields = new Map<number, DistanceField>();
  for (const c of world.citizens) {
    if (c.activity.kind !== 'idle' || c.activity.wait > 0) continue;
    const key = c.pos.y * world.width + c.pos.x;
    let field = fields.get(key);
    if (!field) {
      field = distanceField(world, c.pos, blocked);
      fields.set(key, field);
    }
    startCandidate(world, c, chooseAction(world, c, field), field);
  }
  socialInteractions(world);
  for (const c of world.citizens) driftHappiness(c);

  if (hourStart) hourly(world);
  if (dayStart) daily(world);
}

export function stepTicks(world: World, n: number): void {
  for (let i = 0; i < n; i++) stepWorld(world);
}

function hourly(world: World): void {
  updateWeather(world);
  onEffectsEnded(world, expireEffects(world));
  restockShops(world);
  exportSurplus(world);
  chargeBusinessCosts(world);
  payUpkeep(world);
  for (const closure of checkSolvency(world)) {
    for (const c of closure.laidOff) layOff(world, c, `Laid off when ${buildingLabel(closure.building)} closed`);
    for (const c of world.citizens) {
      if (c.activity.kind !== 'idle' && c.activity.targetId === closure.building.id) goIdle(c);
    }
    pushEvent(world, {
      type: 'businessClosure',
      severity: 'critical',
      title: `${buildingLabel(closure.building)} has closed`,
      description: `The business ran out of money and laid off ${closure.laidOff.length} workers. A city subsidy can reopen it.`,
      causes: closure.causes,
      citizenIds: closure.laidOff.map((c) => c.id),
      buildingIds: [closure.building.id],
    });
  }
  environmentHealth(world);
  const h = hourOf(world.tick);
  if (h >= 8 && h < 18) {
    const schooled = new Map<number, boolean>();
    schoolLearning(world, (homeId) => {
      if (!schooled.has(homeId)) {
        const home = world.buildings.find((b) => b.id === homeId);
        schooled.set(homeId, !!home && neighbourhood(world, home).school);
      }
      return schooled.get(homeId)!;
    });
  }
  for (const c of world.citizens) {
    updateGoals(world, c);
    c.happinessFactors = happinessFactors(world, c);
  }
  checkEmigration(world);
  if (world.tick % IMMIGRATION_INTERVAL === 0) checkImmigration(world);
  detectHourlyEvents(world);
  updatePetitions(world);
  checkMilestones(world);
  updateApproval(world);
  recordSample(world);
  if (h === BULLETIN_HOUR && world.tick >= TICKS_PER_DAY) publishBulletin(world);
}

function daily(world: World): void {
  const { rentMissed } = collectRentAndBenefits(world);
  for (const c of rentMissed) remember(world, c, 'Could not afford rent', -6);
  for (const b of world.buildings) {
    b.yesterday = b.today;
    b.today = { revenue: 0, wagesPaid: 0, wagesUnpaid: 0, unpoweredTicks: 0, sales: 0 };
  }
  for (const c of world.citizens) {
    c.workedToday = 0;
    c.incomeToday = 0;
    c.unpaidToday = 0;
  }
  reviewWages(world);
  const net = Object.values(world.ledger.today).reduce((a, b) => a + b, 0);
  world.eventState.streaks[SURPLUS_DAYS] = net > 0 ? (world.eventState.streaks[SURPLUS_DAYS] ?? 0) + 1 : 0;
  world.ledger.yesterday = world.ledger.today;
  world.ledger.today = {};
  detectUnemploymentTrend(world);
  checkElection(world);
}
