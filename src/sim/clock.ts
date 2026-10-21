// Fixed-timestep accumulator that converts real elapsed time into a whole
// number of simulation ticks, independent of the rendering frame rate.

export const SPEEDS = [1, 2, 4, 8] as const;
export type Speed = (typeof SPEEDS)[number];

export interface ClockOptions {
  /** Real milliseconds per tick at 1x speed. */
  baseStepMs?: number;
  /** Upper bound on ticks per update, to avoid a spiral after long stalls. */
  maxTicksPerUpdate?: number;
}

export class FixedStepClock {
  readonly baseStepMs: number;
  readonly maxTicksPerUpdate: number;
  private accumulator = 0;
  private _paused = false;
  private _speed: Speed = 1;

  constructor(options: ClockOptions = {}) {
    this.baseStepMs = options.baseStepMs ?? 125;
    this.maxTicksPerUpdate = options.maxTicksPerUpdate ?? 16;
  }

  get paused(): boolean {
    return this._paused;
  }

  get speed(): Speed {
    return this._speed;
  }

  get stepMs(): number {
    return this.baseStepMs / this._speed;
  }

  /** Fraction of the next tick already elapsed, used for render interpolation. */
  get alpha(): number {
    return this._paused ? 0 : Math.min(1, this.accumulator / this.stepMs);
  }

  pause(): void {
    this._paused = true;
    this.accumulator = 0;
  }

  resume(): void {
    this._paused = false;
    this.accumulator = 0;
  }

  setSpeed(speed: Speed): void {
    if (!SPEEDS.includes(speed)) throw new Error(`Unsupported speed ${speed}`);
    // Preserve progress through the current tick when switching speed.
    const fraction = this.accumulator / this.stepMs;
    this._speed = speed;
    this.accumulator = fraction * this.stepMs;
  }

  /** Feed elapsed real time; returns how many ticks the simulation should advance. */
  update(elapsedMs: number): number {
    if (this._paused || !(elapsedMs > 0)) return 0;
    this.accumulator += elapsedMs;
    let ticks = Math.floor(this.accumulator / this.stepMs);
    if (ticks > this.maxTicksPerUpdate) {
      ticks = this.maxTicksPerUpdate;
      this.accumulator = 0;
    } else {
      this.accumulator -= ticks * this.stepMs;
    }
    return ticks;
  }
}
