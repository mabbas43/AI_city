// Tile grid helpers and building footprint/entrance logic.

import type { Building, Point, TileKind, World } from './types';

export function inBounds(world: World, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < world.width && y < world.height;
}

export function tileIndex(world: World, x: number, y: number): number {
  return y * world.width + x;
}

export function tileAt(world: World, x: number, y: number): TileKind | undefined {
  if (!inBounds(world, x, y)) return undefined;
  return world.tiles[tileIndex(world, x, y)];
}

export function isRoad(world: World, x: number, y: number): boolean {
  return tileAt(world, x, y) === 'road';
}

export function buildingAt(world: World, x: number, y: number): Building | undefined {
  return world.buildings.find((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
}

/** 1 where a building footprint blocks movement, 0 elsewhere. */
export function blockedGrid(world: World): Uint8Array {
  const grid = new Uint8Array(world.width * world.height);
  for (const b of world.buildings) {
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        if (inBounds(world, x, y)) grid[tileIndex(world, x, y)] = 1;
      }
    }
  }
  return grid;
}

/** Tiles orthogonally adjacent to a footprint, in a fixed deterministic order. */
export function perimeter(x: number, y: number, w: number, h: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < w; i++) out.push({ x: x + i, y: y + h }); // bottom
  for (let j = 0; j < h; j++) out.push({ x: x + w, y: y + j }); // right
  for (let j = 0; j < h; j++) out.push({ x: x - 1, y: y + j }); // left
  for (let i = 0; i < w; i++) out.push({ x: x + i, y: y - 1 }); // top
  return out;
}

export function findEntrance(world: World, b: Pick<Building, 'x' | 'y' | 'w' | 'h'>, blocked = blockedGrid(world)): { entrance: Point; connected: boolean } {
  const candidates = perimeter(b.x, b.y, b.w, b.h).filter(
    (p) => inBounds(world, p.x, p.y) && blocked[tileIndex(world, p.x, p.y)] === 0,
  );
  const road = candidates.find((p) => isRoad(world, p.x, p.y));
  if (road) return { entrance: road, connected: true };
  if (candidates.length > 0) return { entrance: candidates[0], connected: false };
  // Fully enclosed: keep a nominal entrance; navigation will report it unreachable.
  return { entrance: { x: Math.min(world.width - 1, b.x), y: Math.min(world.height - 1, b.y + b.h) }, connected: false };
}

/** Recompute entrances after any change to roads or buildings. */
export function refreshEntrances(world: World): void {
  const blocked = blockedGrid(world);
  for (const b of world.buildings) {
    const { entrance, connected } = findEntrance(world, b, blocked);
    b.entrance = entrance;
    b.connected = connected;
  }
}

export function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
