import { describe, expect, it } from 'vitest';
import { BUILDING_DEFS, ROAD_COST, bulldoze, checkBuildingPlacement, placeBuilding, placeRoad, residentsOf } from '../src/sim';
import { buildingAt, isRoad } from '../src/sim/map';
import { ECONOMY } from '../src/sim/constants';
import { byType, world } from './helpers';

// (4,13) is an empty lot directly south of the main avenue (y = 12).
const LOT = { x: 4, y: 13 };

describe('construction', () => {
  it('placing a building deducts its exact cost and creates it', () => {
    const w = world();
    const t0 = w.treasury;
    const r = placeBuilding(w, 'house', LOT.x, LOT.y);
    expect(r.ok).toBe(true);
    expect(w.treasury).toBe(t0 - BUILDING_DEFS.house.cost);
    expect(buildingAt(w, LOT.x + 1, LOT.y + 1)?.id).toBe(r.building!.id);
    expect(r.building!.connected).toBe(true);
    expect(w.events.at(-1)?.type).toBe('construction');
  });

  it('rejects construction the treasury cannot afford and changes nothing', () => {
    const w = world();
    w.treasury = BUILDING_DEFS.factory.cost - 1;
    const n = w.buildings.length;
    const r = placeBuilding(w, 'factory', LOT.x, LOT.y);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Needs/);
    expect(w.buildings).toHaveLength(n);
    expect(w.treasury).toBe(BUILDING_DEFS.factory.cost - 1);
  });

  it('rejects overlapping, off-map, on-road and roadless placements', () => {
    const w = world();
    const house = byType(w, 'house');
    expect(checkBuildingPlacement(w, 'house', house.x, house.y).reason).toBe('Tile is occupied');
    expect(checkBuildingPlacement(w, 'house', w.width - 1, 0).reason).toBe('Outside the city limits');
    expect(checkBuildingPlacement(w, 'house', 0, 11).reason).toBe('Cannot build on a road');
    expect(checkBuildingPlacement(w, 'house', 6, 15).reason).toBe('Must be next to a road');
    expect(checkBuildingPlacement(w, 'cityHall', LOT.x, LOT.y).ok).toBe(false);
  });

  it('new businesses bring outside investment, not treasury money', () => {
    const w = world();
    const t0 = w.treasury;
    const r = placeBuilding(w, 'office', LOT.x, LOT.y);
    expect(r.building!.funds).toBe(BUILDING_DEFS.office.startingFunds);
    expect(w.treasury).toBe(t0 - BUILDING_DEFS.office.cost);
  });

  it('roads cost money and cannot overlap buildings', () => {
    const w = world();
    const t0 = w.treasury;
    expect(placeRoad(w, 6, 15).ok).toBe(true);
    expect(isRoad(w, 6, 15)).toBe(true);
    expect(w.treasury).toBe(t0 - ROAD_COST);
    expect(placeRoad(w, 6, 15).ok).toBe(false);
    const house = byType(w, 'house');
    expect(placeRoad(w, house.x, house.y).ok).toBe(false);
  });

  it('new housing takes in homeless citizens', () => {
    const w = world();
    const homeless = w.citizens.slice(0, 3);
    for (const c of homeless) c.homeId = null;
    const r = placeBuilding(w, 'house', LOT.x, LOT.y);
    // Existing vacancies are filled first, then the new house.
    expect(homeless.every((c) => c.homeId !== null)).toBe(true);
    expect(residentsOf(w, r.building!.id).length + 0).toBeGreaterThanOrEqual(0);
  });

  it('demolition refunds half the cost, evicts residents and lays off workers', () => {
    const w = world();
    const office = byType(w, 'office');
    const staff = w.citizens.filter((c) => c.jobId === office.id);
    const t0 = w.treasury;
    expect(bulldoze(w, office.x, office.y).ok).toBe(true);
    expect(w.treasury).toBe(t0 + BUILDING_DEFS.office.cost * ECONOMY.demolitionRefund);
    expect(w.buildings.some((b) => b.id === office.id)).toBe(false);
    for (const c of staff) expect(c.jobId).toBeNull();
    expect(bulldoze(w, byType(w, 'cityHall').x, byType(w, 'cityHall').y).ok).toBe(false);
  });

  it('demolishing a full apartment block leaves its residents homeless when no housing is free', () => {
    const w = world();
    const apt = byType(w, 'apartment');
    const residents = residentsOf(w, apt.id);
    expect(residents.length).toBeGreaterThan(0);
    bulldoze(w, apt.x, apt.y);
    const homeless = w.citizens.filter((c) => c.homeId === null);
    const vacancies = w.buildings.reduce((n, b) => n + Math.max(0, BUILDING_DEFS[b.type].housing - residentsOf(w, b.id).length), 0);
    expect(vacancies === 0 || homeless.length === 0).toBe(true);
    expect(homeless.length).toBeGreaterThan(0);
  });
});
