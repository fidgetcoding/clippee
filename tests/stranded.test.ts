import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  /** The next N storage.local.get calls never settle: in flight while the extension reloads. */
  hangGet: 0,
  throwSet: false,
}));
vi.mock('../src/platform', () => ({
  hasExtensionApis: () => true,
  ext: {
    storage: {
      local: {
        get: (key: string) => {
          if (store.hangGet > 0) { store.hangGet--; return new Promise(() => undefined); }
          return Promise.resolve(key in store.data ? { [key]: structuredClone(store.data[key]) } : {});
        },
        set: (items: Record<string, unknown>) => {
          if (store.throwSet) throw new Error('Extension context invalidated.');
          Object.assign(store.data, structuredClone(items));
          return Promise.resolve();
        },
      },
    },
  },
}));

import { Agent } from '../src/character/Agent';
import type { LoadedPack, Pack } from '../src/character/types';
import { storageBag } from '../src/content/bagStore';
import { Presence, RETURN_AFTER_MS, STUCK_AFTER_MS, type PresenceAgent, type PresencePlayer } from '../src/content/presence';
import { APPEAR_POOL, DISAPPEAR_POOL, FxDeck } from '../src/fx/pools';
import type { LabFx } from '../src/fx/types';

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  store.data = {};
  store.hangGet = 0;
  store.throwSet = false;
});

const effects = (): Record<string, LabFx> => Object.fromEntries(
  [...new Set([...APPEAR_POOL, ...DISAPPEAR_POOL])].map((id) => [id, {
    id, name: id, appearMs: 2000, disappearMs: 2000, appear: () => undefined, disappear: () => undefined,
  }]),
);

function fakeAgent(): PresenceAgent {
  let visible = false;
  return {
    get isVisible() { return visible; },
    spot: { x: 500, y: 400 },
    show() { visible = true; },
    hide() { visible = false; },
  };
}

const busy = (p: Presence): boolean => (p as unknown as { busy: boolean }).busy;

describe('a storage call stranded by an extension reload (the bug hunt repro)', () => {
  it('no longer keeps him away: the exit goes on without it, and he comes back', async () => {
    vi.useFakeTimers();
    const agent = fakeAgent();
    const deck = new FxDeck();
    const player: PresencePlayer = { supported: true, play: async () => true, cancel: () => undefined };
    const presence = new Presence({ agent, player, next: (k) => deck.next(k), effects: async () => effects(), reducedMotion: () => false });
    presence.arrive();
    await vi.advanceTimersByTimeAsync(10);
    expect(agent.isVisible).toBe(true);

    // X lands while the bag read is in flight, and the extension reloads: that read never settles.
    store.hangGet = 1;
    presence.leave();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(busy(presence)).toBe(false);
    expect(agent.isVisible).toBe(false);

    // The return timer fires, the shortcut is pressed twice, the toolbar summons: he is back.
    await vi.advanceTimersByTimeAsync(RETURN_AFTER_MS + 1_000);
    presence.toggle();
    presence.toggle();
    if (!presence.here) presence.arrive();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(busy(presence)).toBe(false);
    expect(agent.isVisible).toBe(true);
    presence.dispose();
  });

  it('one stranded read no longer blocks every later draw on the page', async () => {
    vi.useFakeTimers();
    const deck = new FxDeck();
    store.hangGet = 1;
    const first = deck.next('disappear');
    const later = deck.next('appear');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(DISAPPEAR_POOL).toContain(await first);
    expect(APPEAR_POOL).toContain(await later);
  });

  it('a write that throws in a dead context does not stop the draw', async () => {
    store.throwSet = true;
    expect(APPEAR_POOL).toContain(await new FxDeck().next('appear'));
  });

  it('heals on its own if an effect ever hangs, with nobody clicking anything', async () => {
    vi.useFakeTimers();
    const agent = fakeAgent();
    const player: PresencePlayer = { supported: true, play: () => new Promise(() => {}), cancel: () => undefined };
    const presence = new Presence({ agent, player, next: async () => 'x1', effects: async () => effects(), reducedMotion: () => false });
    presence.arrive();
    await vi.advanceTimersByTimeAsync(STUCK_AFTER_MS - 1_000);
    expect(agent.isVisible).toBe(false); // wedged mid-entrance
    await vi.advanceTimersByTimeAsync(1_000);
    expect(agent.isVisible).toBe(true);
    expect(busy(presence)).toBe(false);
    presence.dispose();
  });

  it('the idle bag gives up on a stranded read and keeps going', async () => {
    vi.useFakeTimers();
    store.hangGet = 1;
    const loaded = storageBag('mrclippy:idle-bag').load();
    await vi.advanceTimersByTimeAsync(500);
    await expect(loaded).resolves.toBeUndefined();
    store.throwSet = true;
    expect(() => storageBag('mrclippy:idle-bag').save({ bag: ['a'], last: 'b' })).not.toThrow();
  });
});

describe('never off screen', () => {
  const data = JSON.parse(readFileSync(resolve(__dirname, '../src/packs/clippee/pack.json'), 'utf8')) as Pack;
  const pack: LoadedPack = { name: 'clippee', spriteUrl: 'map.png', data };
  const viewport = (w: number, h: number): void => {
    Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
  };
  afterEach(() => viewport(1024, 768));

  it('comes back inside the window when it shrinks, and remembers the new spot', () => {
    viewport(1600, 1000);
    const moved = vi.fn();
    const agent = new Agent(pack, { position: { x: 1450, y: 880 }, onMoved: moved });
    agent.show(false);
    viewport(900, 600);
    window.dispatchEvent(new Event('resize'));
    expect(agent.spot).toEqual({ x: 900 - 124, y: 600 - 93 });
    expect(moved).toHaveBeenLastCalledWith({ x: 776, y: 507 });
    agent.destroy();
  });

  it('cannot be dragged past the edge', () => {
    viewport(1000, 700);
    const agent = new Agent(pack);
    agent.moveTo(5_000, -300);
    expect(agent.spot).toEqual({ x: 1000 - 124, y: 0 });
    agent.destroy();
  });

  it('Show puts him on screen even if the window shrank while he was away', () => {
    viewport(1600, 1000);
    const agent = new Agent(pack, { position: { x: 1450, y: 880 } });
    viewport(800, 500); // no resize event reached him while hidden
    agent.show(false);
    expect(agent.root.style.left).toBe(`${800 - 124}px`);
    expect(agent.root.style.top).toBe(`${500 - 93}px`);
    agent.destroy();
  });
});
