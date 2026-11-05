import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '../src/character/Agent';
import { IdleScheduler } from '../src/character/IdleScheduler';
import { ShuffleBag, type BagState, type BagStore } from '../src/character/shuffleBag';
import type { LoadedPack, Pack } from '../src/character/types';

const data = JSON.parse(readFileSync(resolve(__dirname, '../src/packs/clippee/pack.json'), 'utf8')) as Pack;
const pack: LoadedPack = { name: 'clippee', spriteUrl: 'map.png', data };
const IDLES = Object.keys(data.animations).filter((n) => n.startsWith('Idle'));

afterEach(() => vi.useRealTimers());

/** A store that keeps the bag in a variable, standing in for storage.local. */
function memoryStore(): BagStore & { saved: BagState | undefined } {
  const store = {
    saved: undefined as BagState | undefined,
    load: async () => store.saved,
    save: (state: BagState) => { store.saved = state; },
  };
  return store;
}

describe('idles', () => {
  it('has nine idles to cycle through, the waddle among them', () => {
    expect(IDLES).toHaveLength(9);
    expect(IDLES).toContain('IdleWaddle');
  });

  it('keeps idling after the first idle ends, cycle after cycle', async () => {
    vi.useFakeTimers();
    const played: string[] = [];
    const agent = new Agent(pack, { idleIntervalMs: 1_000 });
    const animator = (agent as unknown as { animator: { play: (n: string, cb?: unknown) => boolean } }).animator;
    const play = animator.play.bind(animator);
    animator.play = (name, cb) => {
      if (name.startsWith('Idle')) played.push(name);
      return play(name, cb as never);
    };
    agent.show(false);
    // Long enough for several idles back to back; before the fix he froze after one.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(played.length).toBeGreaterThanOrEqual(6);
    agent.destroy();
  });

  it('plays every idle once before any repeats, and never one twice in a row across bags', () => {
    const s = new IdleScheduler(IDLES, () => {}, { random: Math.random });
    const picks = Array.from({ length: IDLES.length * 30 }, () => s.pick()!);
    for (let b = 0; b < 30; b++) {
      expect([...picks.slice(b * IDLES.length, (b + 1) * IDLES.length)].sort()).toEqual([...IDLES].sort());
    }
    for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1]);
  });

  it('picks up the same bag on the next page', async () => {
    const store = memoryStore();
    const first = new ShuffleBag(IDLES, store);
    const seen = [first.next()!, first.next()!, first.next()!];
    // A reload: a new bag over the same store carries on where the old one stopped.
    const second = new ShuffleBag(IDLES, store);
    await Promise.resolve();
    await Promise.resolve();
    for (let i = 3; i < IDLES.length; i++) seen.push(second.next()!);
    expect([...seen].sort()).toEqual([...IDLES].sort());
  });
});
