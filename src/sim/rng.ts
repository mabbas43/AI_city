// Seeded deterministic RNG (mulberry32). The state lives inside the World so
// that saving and loading preserves the random sequence exactly.

import type { World } from './types';

export function nextRandom(state: number): [value: number, nextState: number] {
  const next = (state + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, next];
}

/** Uniform float in [0, 1). Advances world.rngState. */
export function random(world: World): number {
  const [value, next] = nextRandom(world.rngState);
  world.rngState = next;
  return value;
}

export function randomRange(world: World, min: number, max: number): number {
  return min + random(world) * (max - min);
}

export function randomInt(world: World, min: number, maxInclusive: number): number {
  return Math.floor(randomRange(world, min, maxInclusive + 1));
}

export function pick<T>(world: World, items: readonly T[]): T {
  return items[Math.floor(random(world) * items.length)];
}

export function seedToState(seed: number): number {
  // Scramble the seed so nearby seeds give unrelated sequences.
  let s = (seed ^ 0x9e3779b9) | 0;
  s = Math.imul(s ^ (s >>> 16), 0x85ebca6b);
  s = Math.imul(s ^ (s >>> 13), 0xc2b2ae35);
  return (s ^ (s >>> 16)) | 0;
}
