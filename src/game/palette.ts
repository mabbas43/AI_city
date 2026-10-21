// Shared colour language for the map renderer and the React UI.

import type { ActionKind, BuildingType } from '../sim';
import type { BuildingCategory } from '../sim/buildings';

export const ACTION_COLORS: Record<ActionKind | 'idle', number> = {
  work: 0x38bdf8,
  rest: 0xa78bfa,
  eat: 0xf59e0b,
  shop: 0xf472b6,
  socialize: 0x34d399,
  seekJob: 0xfacc15,
  seekCare: 0xfb7185,
  protest: 0xef4444,
  wait: 0x94a3b8,
  idle: 0x94a3b8,
};

export const CATEGORY_COLORS: Record<BuildingCategory, number> = {
  residential: 0x5b6bd6,
  commercial: 0x17a2b8,
  industrial: 0xd08a3a,
  energy: 0xe3b23c,
  public: 0x3fb37f,
};

export const BUILDING_ACCENT: Partial<Record<BuildingType, number>> = {
  apartment: 0x7c8cf0,
  market: 0x2cc6c6,
  cityHall: 0x60d0a8,
  clinic: 0xf0f4f8,
  solarArray: 0x4aa3ff,
  school: 0xf5c451,
};

export const MAP = {
  background: 0x070b16,
  ground: 0x0d1626,
  groundAlt: 0x0f192b,
  grid: 0x16233a,
  road: 0x1a2740,
  roadEdge: 0x24375a,
  roadLine: 0x2ee6d6,
  valid: 0x34d399,
  invalid: 0xef4444,
  select: 0x2ee6d6,
  warning: 0xef4444,
  windowLit: 0xffe7a3,
  windowDark: 0x1b2438,
};

export const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
