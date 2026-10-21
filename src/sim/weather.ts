// Seeded weather. Fronts last several hours; the next front is always known in
// advance so the UI can show a forecast. Weather changes solar output, power
// demand, outdoor plans and mood.

import { TICKS_PER_HOUR } from './constants';
import { pushEvent } from './events';
import { random, randomInt } from './rng';
import type { WeatherKind, WeatherState, World } from './types';

export interface WeatherDef {
  label: string;
  /** Multiplier on solar array output. */
  solar: number;
  /** Multiplier on homes' and businesses' power demand (air conditioning). */
  demand: number;
  /** Mood effect on every citizen. */
  mood: number;
  /** Utility change for socializing outdoors (parks, City Hall plaza). */
  outdoor: number;
  minHours: number;
  maxHours: number;
}

export const WEATHER: Record<WeatherKind, WeatherDef> = {
  clear: { label: 'Clear skies', solar: 1, demand: 1, mood: 2, outdoor: 0.1, minHours: 6, maxHours: 14 },
  cloudy: { label: 'Overcast', solar: 0.55, demand: 1, mood: 0, outdoor: 0, minHours: 4, maxHours: 10 },
  rain: { label: 'Rain', solar: 0.35, demand: 1, mood: -2, outdoor: -0.3, minHours: 3, maxHours: 8 },
  storm: { label: 'Thunderstorm', solar: 0.2, demand: 1, mood: -4, outdoor: -0.7, minHours: 2, maxHours: 5 },
  heatwave: { label: 'Heatwave', solar: 1, demand: 1.2, mood: -5, outdoor: -0.2, minHours: 8, maxHours: 20 },
};

/** Weighted transitions from each kind to the next. */
const TRANSITIONS: Record<WeatherKind, [WeatherKind, number][]> = {
  clear: [['clear', 3], ['cloudy', 4], ['heatwave', 1], ['rain', 1]],
  cloudy: [['clear', 4], ['rain', 3], ['cloudy', 1], ['storm', 1]],
  rain: [['cloudy', 4], ['clear', 2], ['storm', 1], ['rain', 1]],
  storm: [['rain', 3], ['cloudy', 2]],
  heatwave: [['clear', 3], ['storm', 1], ['cloudy', 1]],
};

function sampleNext(world: World, from: WeatherKind): WeatherKind {
  const options = TRANSITIONS[from];
  const total = options.reduce((s, [, w]) => s + w, 0);
  let r = random(world) * total;
  for (const [kind, weight] of options) {
    r -= weight;
    if (r < 0) return kind;
  }
  return options[options.length - 1][0];
}

function duration(world: World, kind: WeatherKind): number {
  const d = WEATHER[kind];
  return randomInt(world, d.minHours, d.maxHours) * TICKS_PER_HOUR;
}

export function initialWeather(world: World): WeatherState {
  return { kind: 'clear', untilTick: world.tick + 8 * TICKS_PER_HOUR, forecast: sampleNext(world, 'clear') };
}

export function weatherDef(world: World): WeatherDef {
  return WEATHER[world.weather.kind];
}

export function hoursUntilChange(world: World): number {
  return Math.max(0, Math.ceil((world.weather.untilTick - world.tick) / TICKS_PER_HOUR));
}

/** Hourly: advance to the forecast front when the current one has run its course. */
export function updateWeather(world: World): void {
  const w = world.weather;
  if (world.tick < w.untilTick) return;
  const previous = w.kind;
  const kind = w.forecast;
  world.weather = { kind, untilTick: world.tick + duration(world, kind), forecast: sampleNext(world, kind) };
  if (kind === previous) return;
  const def = WEATHER[kind];
  const effects: string[] = [];
  if (def.solar !== 1) effects.push(`Solar output at ${Math.round(def.solar * 100)}%`);
  if (def.demand !== 1) effects.push(`Power demand +${Math.round((def.demand - 1) * 100)}% from cooling`);
  if (def.mood) effects.push(`Mood ${def.mood > 0 ? '+' : ''}${def.mood} for everyone`);
  if (def.outdoor < 0) effects.push('Fewer people gather outdoors');
  pushEvent(world, {
    type: 'weather',
    severity: kind === 'storm' || kind === 'heatwave' ? 'warning' : 'info',
    title: `${def.label} ${kind === 'clear' ? 'return' : 'moves in'}`,
    description: `The weather changed from ${WEATHER[previous].label.toLowerCase()} to ${def.label.toLowerCase()} for about ${hoursUntilChange(world)} hours.`,
    causes: [`Weather front: ${WEATHER[previous].label} → ${def.label}`, ...effects],
  });
}
