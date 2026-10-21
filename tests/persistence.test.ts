import { describe, expect, it } from 'vitest';
import { stepTicks, TICKS_PER_DAY } from '../src/sim';
import { SAVE_VERSION, loadFromStorage, parseSave, saveToStorage, serializeWorld, type KeyValueStorage } from '../src/sim/persistence';
import { world } from './helpers';

class MemoryStorage implements KeyValueStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

function mutate(text: string, f: (w: Record<string, any>) => void): string {
  const file = JSON.parse(text);
  f(file.world);
  return JSON.stringify(file);
}

describe('save/load', () => {
  it('round-trips the full world state', () => {
    const w = world(31);
    stepTicks(w, 300);
    const r = parseSave(serializeWorld(w, '2026-01-01T00:00:00Z'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.stringify(r.world)).toBe(JSON.stringify(w));
    expect(r.savedAt).toBe('2026-01-01T00:00:00Z');
  });

  it('a loaded world continues exactly like the original (deterministic resume)', () => {
    const original = world(32);
    stepTicks(original, 200);
    const r = parseSave(serializeWorld(original, ''));
    if (!r.ok) throw new Error(r.error);
    stepTicks(original, TICKS_PER_DAY);
    stepTicks(r.world, TICKS_PER_DAY);
    expect(JSON.stringify(r.world)).toBe(JSON.stringify(original));
  });

  it('saves to and loads from storage', () => {
    const s = new MemoryStorage();
    const w = world(33);
    expect(saveToStorage(s, w, 'now').ok).toBe(true);
    const r = loadFromStorage(s);
    expect(r.ok && r.world.citizens.length).toBe(20);
  });

  it('reports a missing save gracefully', () => {
    const r = loadFromStorage(new MemoryStorage());
    expect(r).toEqual({ ok: false, error: 'No saved game found' });
  });

  it('handles storage exceptions without throwing', () => {
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => {},
    };
    expect(saveToStorage(broken, world(), 'x')).toEqual({ ok: false, error: 'Could not write save: quota exceeded' });
    expect(loadFromStorage(broken).ok).toBe(false);
  });

  it('rejects corrupted JSON, foreign files and future versions', () => {
    expect(parseSave('{not json').ok).toBe(false);
    expect(parseSave(JSON.stringify({ hello: 1 }))).toEqual({ ok: false, error: 'Not an AI City save file' });
    const text = serializeWorld(world(), '');
    const future = JSON.stringify({ ...JSON.parse(text), version: SAVE_VERSION + 1 });
    const r = parseSave(future);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/newer version/);
  });

  it('rejects duplicate citizen ids', () => {
    const text = mutate(serializeWorld(world(), ''), (w) => {
      w.citizens[1].id = w.citizens[0].id;
    });
    const r = parseSave(text);
    expect(!r.ok && r.error).toMatch(/Duplicate citizen id/);
  });

  it('rejects negative treasury, bad needs, dangling references and overfull buildings', () => {
    const base = serializeWorld(world(), '');
    const cases: [string, (w: Record<string, any>) => void][] = [
      ['Treasury', (w) => (w.treasury = -5)],
      ['needs.hunger', (w) => (w.citizens[0].needs.hunger = 400)],
      ['home does not exist', (w) => (w.citizens[0].homeId = 999)],
      ['more employees than jobs', (w) => w.citizens.forEach((c: any) => (c.jobId = w.buildings.find((b: any) => b.type === 'shop').id))],
      ['overlaps', (w) => (w.buildings[1].x = w.buildings[0].x)],
      ['Tile grid', (w) => (w.tiles = w.tiles.slice(1))],
      ['City Hall is missing', (w) => (w.buildings = w.buildings.filter((b: any) => b.type !== 'cityHall'))],
      ['negative', (w) => (w.citizens[0].money = -1)],
    ];
    for (const [msg, f] of cases) {
      const r = parseSave(mutate(base, f));
      expect(r.ok, msg).toBe(false);
      if (!r.ok && msg !== 'negative') expect(r.error).toContain(msg);
    }
  });

  it('a failed load does not modify anything (returns no world)', () => {
    const r = parseSave(mutate(serializeWorld(world(), ''), (w) => (w.citizens = 'oops')));
    expect(r.ok).toBe(false);
    expect('world' in r).toBe(false);
  });
});
