// Player construction commands: placing buildings and roads, and demolition.
// All commands validate first and leave the world untouched on failure.

import { evictFromBlockedTiles, goIdle } from './activities';
import { BUILDING_DEFS, ROAD_COST, buildingLabel, employeesOf, residentsOf } from './buildings';
import { findVacantHome, layOff, remember } from './citizens';
import { ECONOMY } from './constants';
import { EXTERNAL, TREASURY, roundMoney, transfer } from './economy';
import { pushEvent } from './events';
import { BUILDINGS_PLACED, lockedReason } from './milestones';
import { buildingAt, findEntrance, inBounds, isRoad, perimeter, refreshEntrances, tileIndex } from './map';
import type { Building, BuildingType, World } from './types';

export interface CommandResult {
  ok: boolean;
  reason?: string;
  building?: Building;
}

const emptyDay = () => ({ revenue: 0, wagesPaid: 0, wagesUnpaid: 0, unpoweredTicks: 0, sales: 0 });

/** Create a building without charging for it (used for the starting city). */
export function createBuilding(world: World, type: BuildingType, x: number, y: number): Building {
  const d = BUILDING_DEFS[type];
  const b: Building = {
    id: world.nextBuildingId++,
    type,
    x,
    y,
    w: d.w,
    h: d.h,
    entrance: { x, y: y + d.h },
    connected: false,
    funds: d.startingFunds,
    stock: type === 'shop' || type === 'market' ? 40 : 0,
    powered: true,
    status: 'operational',
    distressHours: 0,
    unpaidUpkeepHours: 0,
    builtAt: world.tick,
    today: emptyDay(),
    yesterday: emptyDay(),
  };
  world.buildings.push(b);
  const { entrance, connected } = findEntrance(world, b);
  b.entrance = entrance;
  b.connected = connected;
  return b;
}

export function checkBuildingPlacement(world: World, type: BuildingType, x: number, y: number): CommandResult {
  const d = BUILDING_DEFS[type];
  if (!d) return { ok: false, reason: 'Unknown building type' };
  if (!d.buildable) return { ok: false, reason: `${d.label} cannot be built` };
  const locked = lockedReason(world, type);
  if (locked) return { ok: false, reason: locked };
  if (!Number.isInteger(x) || !Number.isInteger(y)) return { ok: false, reason: 'Invalid position' };
  for (let j = 0; j < d.h; j++) {
    for (let i = 0; i < d.w; i++) {
      const tx = x + i;
      const ty = y + j;
      if (!inBounds(world, tx, ty)) return { ok: false, reason: 'Outside the city limits' };
      if (isRoad(world, tx, ty)) return { ok: false, reason: 'Cannot build on a road' };
      if (buildingAt(world, tx, ty)) return { ok: false, reason: 'Tile is occupied' };
    }
  }
  if (!perimeter(x, y, d.w, d.h).some((p) => isRoad(world, p.x, p.y))) {
    return { ok: false, reason: 'Must be next to a road' };
  }
  if (world.treasury < d.cost) return { ok: false, reason: `Needs ${d.cost} cr (treasury has ${Math.floor(world.treasury)})` };
  return { ok: true };
}

export function placeBuilding(world: World, type: BuildingType, x: number, y: number): CommandResult {
  const check = checkBuildingPlacement(world, type, x, y);
  if (!check.ok) return check;
  const d = BUILDING_DEFS[type];
  if (!transfer(world, TREASURY, EXTERNAL, d.cost, 'construction')) return { ok: false, reason: 'Insufficient funds' };
  const b = createBuilding(world, type, x, y);
  world.eventState.streaks[BUILDINGS_PLACED] = (world.eventState.streaks[BUILDINGS_PLACED] ?? 0) + 1;
  // New businesses are capitalised by outside investors, not the treasury.
  if (b.funds > 0) {
    b.funds = 0;
    transfer(world, EXTERNAL, { kind: 'building', building: b }, d.startingFunds, 'investment');
  }
  refreshEntrances(world);
  evictFromBlockedTiles(world);
  const housed = d.housing > 0 ? rehouseHomeless(world) : 0;
  const details = [`Construction cost ${d.cost} cr`];
  if (d.jobs > 0) details.push(`Creates ${d.jobs} jobs`);
  if (d.housing > 0) details.push(`Houses ${d.housing} citizens${housed ? ` (${housed} homeless moved in)` : ''}`);
  if (d.powerSupply > 0) details.push(`Adds up to ${d.powerSupply} power`);
  if (d.powerDemand > 0) details.push(`Draws ${d.powerDemand} power`);
  pushEvent(world, {
    type: 'construction',
    severity: 'info',
    title: `${d.label} built`,
    description: `A new ${d.label.toLowerCase()} opened at (${x}, ${y}).`,
    causes: details,
    buildingIds: [b.id],
  });
  return { ok: true, building: b };
}

/** Move homeless citizens into any vacant housing. Returns how many found homes. */
export function rehouseHomeless(world: World): number {
  let count = 0;
  for (const c of world.citizens) {
    if (c.homeId !== null) continue;
    const home = findVacantHome(world);
    if (!home) break;
    c.homeId = home.id;
    remember(world, c, `Moved into ${buildingLabel(home)}`, 12);
    count += 1;
  }
  return count;
}

export function checkRoadPlacement(world: World, x: number, y: number): CommandResult {
  if (!inBounds(world, x, y)) return { ok: false, reason: 'Outside the city limits' };
  if (isRoad(world, x, y)) return { ok: false, reason: 'Already a road' };
  if (buildingAt(world, x, y)) return { ok: false, reason: 'Tile is occupied' };
  if (world.treasury < ROAD_COST) return { ok: false, reason: `Needs ${ROAD_COST} cr` };
  return { ok: true };
}

export function placeRoad(world: World, x: number, y: number): CommandResult {
  const check = checkRoadPlacement(world, x, y);
  if (!check.ok) return check;
  if (!transfer(world, TREASURY, EXTERNAL, ROAD_COST, 'construction')) return { ok: false, reason: 'Insufficient funds' };
  world.tiles[tileIndex(world, x, y)] = 'road';
  refreshEntrances(world);
  return { ok: true };
}

export function bulldoze(world: World, x: number, y: number): CommandResult {
  if (!inBounds(world, x, y)) return { ok: false, reason: 'Outside the city limits' };
  const b = buildingAt(world, x, y);
  if (b) return demolishBuilding(world, b);
  if (isRoad(world, x, y)) {
    world.tiles[tileIndex(world, x, y)] = 'grass';
    refreshEntrances(world);
    return { ok: true };
  }
  return { ok: false, reason: 'Nothing to demolish' };
}

export function demolishBuilding(world: World, b: Building): CommandResult {
  const d = BUILDING_DEFS[b.type];
  if (b.type === 'cityHall') return { ok: false, reason: 'City Hall cannot be demolished' };
  const residents = residentsOf(world, b.id);
  const staff = employeesOf(world, b.id);
  for (const c of residents) {
    c.homeId = null;
    remember(world, c, `Lost their home when ${buildingLabel(b)} was demolished`, -20);
  }
  for (const c of staff) layOff(world, c, `Lost their job when ${buildingLabel(b)} was demolished`);
  for (const c of world.citizens) {
    if (c.insideId === b.id) c.insideId = null;
    if (c.activity.kind !== 'idle' && c.activity.targetId === b.id) goIdle(c);
  }
  // Remaining business cash leaves the city with its owners.
  if (b.funds > 0) transfer(world, { kind: 'building', building: b }, EXTERNAL, b.funds, 'liquidation');
  world.buildings = world.buildings.filter((x) => x.id !== b.id);
  const refund = roundMoney(d.cost * ECONOMY.demolitionRefund);
  if (refund > 0) transfer(world, EXTERNAL, TREASURY, refund, 'refund');
  refreshEntrances(world);
  rehouseHomeless(world);
  const causes = [`Demolished by the city (refund ${refund} cr)`];
  if (residents.length) causes.push(`${residents.length} residents displaced`);
  if (staff.length) causes.push(`${staff.length} workers laid off`);
  pushEvent(world, {
    type: 'demolition',
    severity: residents.length || staff.length ? 'warning' : 'info',
    title: `${buildingLabel(b)} demolished`,
    description: `The ${d.label.toLowerCase()} was removed.`,
    causes,
    citizenIds: [...residents, ...staff].map((c) => c.id),
    buildingIds: [b.id],
  });
  return { ok: true };
}
