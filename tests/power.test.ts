import { describe, expect, it } from 'vitest';
import { BUILDING_DEFS, placeBuilding, stepTicks, stepWorld } from '../src/sim';
import { CONSERVATION_FACTOR, UPKEEP_SHUTDOWN_HOURS, updatePower } from '../src/sim/power';
import { payUpkeep } from '../src/sim/economy';
import { chooseAction } from '../src/sim/decision';
import { distanceField } from '../src/sim/navigation';
import { atHour, byType, prime, world } from './helpers';

function overload(w: ReturnType<typeof world>) {
  w.treasury = 100_000;
  // Three more factories push demand (36.5 + 27) past the plant's 60.
  expect(placeBuilding(w, 'factory', 4, 13).ok).toBe(true);
  expect(placeBuilding(w, 'factory', 8, 13).ok).toBe(true);
  expect(placeBuilding(w, 'factory', 14, 13).ok).toBe(true);
}

describe('power grid', () => {
  it('starting city has enough power', () => {
    const w = world();
    updatePower(w);
    expect(w.power.supply).toBe(60);
    expect(w.power.shortage).toBe(false);
    expect(w.buildings.every((b) => b.powered)).toBe(true);
  });

  it('when demand exceeds supply, the lowest-priority buildings lose power first', () => {
    const w = world();
    overload(w);
    updatePower(w);
    expect(w.power.shortage).toBe(true);
    expect(w.power.demand).toBeGreaterThan(w.power.supply);
    const dark = w.buildings.filter((b) => !b.powered);
    expect(dark.length).toBeGreaterThan(0);
    expect(dark.every((b) => b.type === 'factory')).toBe(true);
    expect(byType(w, 'clinic').powered).toBe(true);
    expect(byType(w, 'house').powered).toBe(true);
  });

  it('a power shortage raises a critical event that names its cause', () => {
    const w = world();
    overload(w);
    stepWorld(w);
    const ev = w.events.find((e) => e.type === 'powerShortage');
    expect(ev?.severity).toBe('critical');
    expect(ev?.causes[0]).toMatch(/Demand .* exceeds supply 60/);
    expect(ev?.buildingIds.length).toBeGreaterThan(0);
  });

  it('unpowered workplaces stop employment: workers cannot choose to work there', () => {
    const w = world();
    atHour(w, 10);
    const office = byType(w, 'office');
    const worker = prime(w.citizens.find((c) => c.jobId === office.id)!);
    office.powered = false;
    // Make sure the next power update also leaves it dark.
    const plant = byType(w, 'powerStation');
    plant.unpaidUpkeepHours = UPKEEP_SHUTDOWN_HOURS;
    updatePower(w);
    expect(office.powered).toBe(false);
    expect(chooseAction(w, worker, distanceField(w, worker.pos)).action).not.toBe('work');
  });

  it('upkeep the treasury cannot pay accumulates as overdue hours', () => {
    const w = world();
    w.treasury = 0;
    payUpkeep(w);
    payUpkeep(w);
    expect(byType(w, 'powerStation').unpaidUpkeepHours).toBe(2);
    expect(w.treasury).toBe(0);
    w.treasury = 1000;
    payUpkeep(w);
    expect(byType(w, 'powerStation').unpaidUpkeepHours).toBe(0);
  });

  it('a plant with overdue upkeep shuts down, causing a shortage event that cites the upkeep', () => {
    const w = world();
    byType(w, 'powerStation').unpaidUpkeepHours = UPKEEP_SHUTDOWN_HOURS;
    w.treasury = 0;
    stepWorld(w);
    expect(w.power.supply).toBe(0);
    expect(w.power.shortage).toBe(true);
    const ev = w.events.find((e) => e.type === 'powerShortage');
    expect(ev?.causes.join(' ')).toMatch(/upkeep unpaid/);
  });

  it('energy conservation reduces demand by 20%', () => {
    const w = world();
    updatePower(w);
    const normal = w.power.demand;
    w.policies.energyConservation = true;
    updatePower(w);
    expect(w.power.demand).toBeCloseTo(normal * CONSERVATION_FACTOR, 1);
  });

  it('power is restored (with an event) after building new supply', () => {
    const w = world();
    overload(w);
    stepWorld(w);
    expect(w.power.shortage).toBe(true);
    expect(placeBuilding(w, 'powerStation', 14, 20).ok).toBe(true);
    stepTicks(w, 13);
    expect(w.power.shortage).toBe(false);
    expect(w.buildings.every((b) => b.powered || BUILDING_DEFS[b.type].powerDemand === 0)).toBe(true);
    expect(w.events.some((e) => e.type === 'powerRestored')).toBe(true);
  });

  it('solar arrays produce less at night', () => {
    const w = world();
    w.treasury = 10_000;
    const solar = placeBuilding(w, 'solarArray', 4, 13).building!;
    atHour(w, 12);
    updatePower(w);
    const day = w.power.supply;
    atHour(w, 23);
    updatePower(w);
    expect(day - w.power.supply).toBe(BUILDING_DEFS.solarArray.powerSupply - 2);
    expect(solar.powered).toBe(true);
  });
});
