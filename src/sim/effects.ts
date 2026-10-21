// Timed city-wide effects and approval modifiers created by player decisions.

import { TICKS_PER_HOUR } from './constants';
import type { ActiveEffect, EffectKind, World } from './types';

export function activeEffect(world: World, kind: EffectKind): ActiveEffect | undefined {
  return world.effects.find((e) => e.kind === kind && e.startTick <= world.tick && world.tick < e.untilTick);
}

export function addEffect(world: World, kind: EffectKind, label: string, hours: number, value = 0): ActiveEffect {
  const e: ActiveEffect = { kind, label, startTick: world.tick, untilTick: world.tick + Math.round(hours * TICKS_PER_HOUR), value };
  world.effects = world.effects.filter((x) => x.kind !== kind);
  world.effects.push(e);
  return e;
}

export function addApprovalModifier(world: World, label: string, value: number, hours: number): void {
  world.approval.modifiers.push({ label, value, untilTick: world.tick + Math.round(hours * TICKS_PER_HOUR) });
}

/** Extra power bought from outside the city. */
export function importedPower(world: World): number {
  return activeEffect(world, 'powerImport')?.value ?? 0;
}

/** Drops expired effects and modifiers. Returns the effects that just ended. */
export function expireEffects(world: World): ActiveEffect[] {
  const ended = world.effects.filter((e) => world.tick >= e.untilTick);
  world.effects = world.effects.filter((e) => world.tick < e.untilTick);
  world.approval.modifiers = world.approval.modifiers.filter((m) => world.tick < m.untilTick);
  return ended;
}
