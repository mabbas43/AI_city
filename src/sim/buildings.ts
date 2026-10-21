// Building catalogue and read-only queries about buildings.

import type { Building, BuildingType, Citizen, Skills, World } from './types';

export type BuildingCategory = 'residential' | 'commercial' | 'industrial' | 'energy' | 'public';

export interface BuildingDef {
  type: BuildingType;
  label: string;
  category: BuildingCategory;
  description: string;
  w: number;
  h: number;
  cost: number;
  /** Power units consumed while powered. */
  powerDemand: number;
  /** Power units produced at full output. */
  powerSupply: number;
  housing: number;
  jobs: number;
  /** Base gross wage per worked tick. */
  baseWage: number;
  jobSkill: keyof Skills | null;
  jobTitle: string;
  /** Treasury upkeep per day (public buildings only). */
  upkeepPerDay: number;
  /** Business operating cost per hour, paid to suppliers outside the city. */
  operatingCostPerHour: number;
  /** Rent per resident per day, paid to the treasury. */
  rentPerDay: number;
  startingFunds: number;
  isPublic: boolean;
  buildable: boolean;
  /** Lower number = served first during power shortages. */
  powerPriority: number;
  /** Retail price multiplier. */
  priceFactor: number;
  /** Offices and factories do not run shifts on Saturdays and Sundays. */
  closedOnWeekends: boolean;
  /** City rank required before it can be built (0 = always available). */
  unlockRank: number;
}

const def = (d: Partial<BuildingDef> & Pick<BuildingDef, 'type' | 'label' | 'category' | 'description' | 'w' | 'h' | 'cost'>): BuildingDef => ({
  powerDemand: 0,
  powerSupply: 0,
  housing: 0,
  jobs: 0,
  baseWage: 0,
  jobSkill: null,
  jobTitle: '',
  upkeepPerDay: 0,
  operatingCostPerHour: 0,
  rentPerDay: 0,
  startingFunds: 0,
  isPublic: false,
  buildable: true,
  powerPriority: 5,
  priceFactor: 1,
  closedOnWeekends: false,
  unlockRank: 0,
  ...d,
});

export const BUILDING_DEFS: Record<BuildingType, BuildingDef> = {
  house: def({
    type: 'house', label: 'House', category: 'residential', w: 2, h: 2, cost: 300,
    description: 'Homes for 4 citizens. Residents pay rent to the city.',
    powerDemand: 2, housing: 4, rentPerDay: 14, powerPriority: 2,
  }),
  apartment: def({
    type: 'apartment', label: 'Apartment Tower', category: 'residential', w: 2, h: 2, cost: 850,
    description: 'Dense housing for 10 citizens. Lower rent, higher power use.',
    powerDemand: 5, housing: 10, rentPerDay: 11, powerPriority: 2,
  }),
  office: def({
    type: 'office', label: 'Office', category: 'commercial', w: 2, h: 2, cost: 900,
    description: 'Six technical jobs. Earns revenue from outside contracts.',
    powerDemand: 4, jobs: 6, baseWage: 1.1, jobSkill: 'technical', jobTitle: 'Analyst',
    operatingCostPerHour: 1.5, startingFunds: 800, powerPriority: 4, closedOnWeekends: true,
  }),
  factory: def({
    type: 'factory', label: 'Fabricator', category: 'industrial', w: 3, h: 2, cost: 1200,
    description: 'Eight manual jobs. Produces goods for shops; surplus is exported. Pollutes nearby homes.',
    powerDemand: 9, jobs: 8, baseWage: 1.0, jobSkill: 'manual', jobTitle: 'Fabricator',
    operatingCostPerHour: 2.5, startingFunds: 1000, powerPriority: 5, closedOnWeekends: true,
  }),
  shop: def({
    type: 'shop', label: 'Shop', category: 'commercial', w: 2, h: 2, cost: 500,
    description: 'Two service jobs. Sells meals, groceries and luxuries.',
    powerDemand: 2, jobs: 2, baseWage: 0.85, jobSkill: 'social', jobTitle: 'Shopkeeper',
    operatingCostPerHour: 0.8, startingFunds: 400, powerPriority: 3,
  }),
  market: def({
    type: 'market', label: 'Market Hall', category: 'commercial', w: 3, h: 2, cost: 750,
    description: 'Two service jobs. Market hall with 15% lower prices.',
    powerDemand: 2, jobs: 2, baseWage: 0.85, jobSkill: 'social', jobTitle: 'Vendor', priceFactor: 0.85,
    operatingCostPerHour: 1.2, startingFunds: 500, powerPriority: 3,
  }),
  powerStation: def({
    type: 'powerStation', label: 'Fusion Plant', category: 'energy', w: 3, h: 3, cost: 2200,
    description: 'Produces 60 power. Needs staff and treasury upkeep to run at full output.',
    powerSupply: 60, jobs: 2, baseWage: 1.0, jobSkill: 'technical', jobTitle: 'Grid Engineer',
    upkeepPerDay: 60, isPublic: true, powerPriority: 0,
  }),
  solarArray: def({
    type: 'solarArray', label: 'Solar Array', category: 'energy', w: 2, h: 2, cost: 700,
    description: 'Produces 14 power in daylight, 2 at night. Cheap upkeep, no staff.',
    powerSupply: 14, upkeepPerDay: 6, isPublic: true, powerPriority: 0,
  }),
  park: def({
    type: 'park', label: 'Park', category: 'public', w: 3, h: 3, cost: 250,
    description: 'Gathering place. Raises happiness of nearby residents.',
    powerDemand: 0.5, upkeepPerDay: 8, isPublic: true, powerPriority: 6,
  }),
  clinic: def({
    type: 'clinic', label: 'Clinic', category: 'public', w: 2, h: 2, cost: 1000,
    description: 'Heals sick citizens. Two medical jobs paid by the city.',
    powerDemand: 3, jobs: 2, baseWage: 1.0, jobSkill: 'social', jobTitle: 'Medic',
    upkeepPerDay: 40, isPublic: true, powerPriority: 1,
  }),
  school: def({
    type: 'school', label: 'School', category: 'public', w: 2, h: 2, cost: 900,
    description: 'Residents nearby slowly gain skills, earning better wages. Two teaching jobs paid by the city.',
    powerDemand: 3, jobs: 2, baseWage: 1.0, jobSkill: 'social', jobTitle: 'Teacher',
    upkeepPerDay: 35, isPublic: true, powerPriority: 1, unlockRank: 1,
  }),
  cityHall: def({
    type: 'cityHall', label: 'City Hall', category: 'public', w: 3, h: 3, cost: 0,
    description: 'Job center and civic heart. Protests gather here.',
    powerDemand: 3, jobs: 2, baseWage: 0.9, jobSkill: 'social', jobTitle: 'Civil Servant',
    upkeepPerDay: 30, isPublic: true, buildable: false, powerPriority: 0,
  }),
};

export const ROAD_COST = 10;
export const ROAD_UPKEEP_PER_DAY = 0.2;

export const BUILDABLE_TYPES: BuildingType[] = (Object.keys(BUILDING_DEFS) as BuildingType[]).filter(
  (t) => BUILDING_DEFS[t].buildable,
);

export function getBuilding(world: World, id: number | null | undefined): Building | undefined {
  if (id === null || id === undefined) return undefined;
  return world.buildings.find((b) => b.id === id);
}

export function getCitizen(world: World, id: number | null | undefined): Citizen | undefined {
  if (id === null || id === undefined) return undefined;
  return world.citizens.find((c) => c.id === id);
}

export function residentsOf(world: World, buildingId: number): Citizen[] {
  return world.citizens.filter((c) => c.homeId === buildingId);
}

export function employeesOf(world: World, buildingId: number): Citizen[] {
  return world.citizens.filter((c) => c.jobId === buildingId);
}

export function workersPresent(world: World, buildingId: number): Citizen[] {
  return world.citizens.filter(
    (c) => c.jobId === buildingId && c.activity.kind === 'performing' && c.activity.action === 'work' && c.activity.targetId === buildingId,
  );
}

export function vacancies(world: World, b: Building): number {
  return Math.max(0, BUILDING_DEFS[b.type].housing - residentsOf(world, b.id).length);
}

export function openJobs(world: World, b: Building): number {
  if (b.status !== 'operational') return 0;
  return Math.max(0, BUILDING_DEFS[b.type].jobs - employeesOf(world, b.id).length);
}

export function isRetail(b: Building): boolean {
  return b.type === 'shop' || b.type === 'market';
}

/** A building can serve citizens when it is open and has electricity (parks need neither). */
export function isOperational(b: Building): boolean {
  if (b.status !== 'operational') return false;
  if (b.type === 'park' || b.type === 'solarArray') return true;
  return b.powered;
}

/** Shops sell only when open, powered, staffed and stocked. */
export function canSell(world: World, b: Building): boolean {
  return isRetail(b) && isOperational(b) && b.stock >= 1 && employeesOf(world, b.id).length > 0;
}

export function buildingLabel(b: Building): string {
  return `${BUILDING_DEFS[b.type].label} #${b.id}`;
}

export function footprintContains(b: Building, x: number, y: number): boolean {
  return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
}

export function buildingCenter(b: Building): { x: number; y: number } {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}
