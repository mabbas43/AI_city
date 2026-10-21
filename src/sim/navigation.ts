// Weighted grid pathfinding. Citizens walk anywhere that is not covered by a
// building; roads are three times faster than open ground.

import { GRASS_STEP_TICKS, ROAD_STEP_TICKS } from './constants';
import { blockedGrid, inBounds, tileIndex } from './map';
import type { Point, World } from './types';

export interface DistanceField {
  width: number;
  dist: Float64Array;
  prev: Int32Array;
  start: Point;
}

export function stepCost(world: World, x: number, y: number): number {
  return world.tiles[tileIndex(world, x, y)] === 'road' ? ROAD_STEP_TICKS : GRASS_STEP_TICKS;
}

function swap(k: number[], v: number[], a: number, b: number): void {
  const tk = k[a];
  k[a] = k[b];
  k[b] = tk;
  const tv = v[a];
  v[a] = v[b];
  v[b] = tv;
}

/** Minimal binary heap keyed by distance. */
class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(key: number, val: number): void {
    const k = this.keys;
    const v = this.vals;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] < k[i] || (k[p] === k[i] && v[p] <= v[i])) break;
      swap(k, v, p, i);
      i = p;
    }
  }
  pop(): [number, number] {
    const k = this.keys;
    const v = this.vals;
    const top: [number, number] = [k[0], v[0]];
    const lk = k.pop()!;
    const lv = v.pop()!;
    if (k.length > 0) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && (k[l] < k[m] || (k[l] === k[m] && v[l] < v[m]))) m = l;
        if (r < k.length && (k[r] < k[m] || (k[r] === k[m] && v[r] < v[m]))) m = r;
        if (m === i) break;
        swap(k, v, m, i);
        i = m;
      }
    }
    return top;
  }
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Travel time (in ticks) from `start` to every tile. Unreachable tiles are Infinity. */
export function distanceField(world: World, start: Point, blocked = blockedGrid(world)): DistanceField {
  const n = world.width * world.height;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const result: DistanceField = { width: world.width, dist, prev, start };
  if (!inBounds(world, start.x, start.y)) return result;
  const s = tileIndex(world, start.x, start.y);
  dist[s] = 0;
  const heap = new MinHeap();
  heap.push(0, s);
  while (heap.size > 0) {
    const [d, idx] = heap.pop();
    if (d > dist[idx]) continue;
    const x = idx % world.width;
    const y = (idx - x) / world.width;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(world, nx, ny)) continue;
      const ni = tileIndex(world, nx, ny);
      if (blocked[ni]) continue;
      const nd = d + stepCost(world, nx, ny);
      if (nd < dist[ni]) {
        dist[ni] = nd;
        prev[ni] = idx;
        heap.push(nd, ni);
      }
    }
  }
  return result;
}

export function travelTime(field: DistanceField, to: Point): number {
  return field.dist[to.y * field.width + to.x];
}

/** Path from field start to `to`, excluding the start tile. Null if unreachable. */
export function extractPath(field: DistanceField, to: Point): Point[] | null {
  const goal = to.y * field.width + to.x;
  if (!Number.isFinite(field.dist[goal])) return null;
  const out: Point[] = [];
  let cur = goal;
  const startIdx = field.start.y * field.width + field.start.x;
  while (cur !== startIdx) {
    out.push({ x: cur % field.width, y: Math.floor(cur / field.width) });
    cur = field.prev[cur];
    if (cur < 0) return null;
  }
  out.reverse();
  return out;
}

export function findPath(world: World, from: Point, to: Point): Point[] | null {
  return extractPath(distanceField(world, from), to);
}
