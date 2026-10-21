import { MINUTES_PER_TICK, TICKS_PER_DAY, TICKS_PER_HOUR } from './constants';

export function dayOf(tick: number): number {
  return Math.floor(tick / TICKS_PER_DAY) + 1;
}

/** Fractional hour of day, 0..24. */
export function hourOf(tick: number): number {
  return (tick % TICKS_PER_DAY) / TICKS_PER_HOUR;
}

export function isNight(tick: number): boolean {
  const h = hourOf(tick);
  return h >= 22 || h < 6;
}

export function isHourStart(tick: number): boolean {
  return tick % TICKS_PER_HOUR === 0;
}

export function isDayStart(tick: number): boolean {
  return tick % TICKS_PER_DAY === 0;
}

export function formatClock(tick: number): string {
  const minutes = (tick % TICKS_PER_DAY) * MINUTES_PER_TICK;
  const hh = Math.floor(minutes / 60).toString().padStart(2, '0');
  const mm = (minutes % 60).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

export function formatTimestamp(tick: number): string {
  return `Day ${dayOf(tick)} ${formatClock(tick)}`;
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** 0 = Monday … 6 = Sunday. Day 1 is a Monday. */
export function weekdayIndex(tick: number): number {
  return (dayOf(tick) - 1) % 7;
}

export function weekdayName(tick: number): string {
  return WEEKDAYS[weekdayIndex(tick)];
}

export function isWeekend(tick: number): boolean {
  return weekdayIndex(tick) >= 5;
}
