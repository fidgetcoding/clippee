import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ data: {} as Record<string, unknown>, query: vi.fn(), send: vi.fn() }));
vi.mock('../src/platform', () => ({
  hasExtensionApis: () => true,
  ext: {
    storage: {
      local: {
        get: async (key: string) => (key in store.data ? { [key]: structuredClone(store.data[key]) } : {}),
        set: async (items: Record<string, unknown>) => { Object.assign(store.data, structuredClone(items)); },
      },
    },
    tabs: { query: store.query, sendMessage: store.send },
  },
}));

import { APPEAR_POOL, DISAPPEAR_POOL, FxDeck, drawFromBag, type BagState } from '../src/fx/pools';
import { FxPlayer } from '../src/fx/FxPlayer';
import type { FxKind, LabFx } from '../src/fx/types';
import { Presence, RETURN_AFTER_MS, type PresenceAgent, type PresencePlayer } from '../src/content/presence';
import { summonOnActiveTab } from '../src/popup/summon';
import { fixAllBar } from '../src/content/changeCards';
import type { AgentChange, Thread } from '../src/content/chatTypes';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  store.data = {};
  store.query.mockReset();
  store.send.mockReset();
});

/** A seeded generator, so the bag tests replay exactly. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('the pools Nate starred', () => {
  it('has exactly the 11 entrances and 8 exits from the round 2 lab', () => {
    expect([...APPEAR_POOL].sort()).toEqual(['c1', 'c4', 'p1', 'p2', 'r1', 'r4', 'r5', 'x1', 'x2', 'x3', 'x4']);
    expect([...DISAPPEAR_POOL].sort()).toEqual(['c4', 'p2', 'p4', 'r1', 'r4', 'x2', 'x3', 'x4']);
  });

  it('bundles every pooled effect, and the bundle is up to date with src/fx/lab', () => {
    // Fails when someone edits a lab file and forgets `npm run fx`.
    execFileSync(process.execPath, [resolve(__dirname, '../scripts/build-fx.mjs'), '--check']);
  });

  it('registers exactly the pooled ids when the bundle is built', async () => {
    // Building the library makes canvases; jsdom has no 2D context, so hand it an inert one.
    const inert: object = new Proxy(function () {}, { get: () => inert, apply: () => inert });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => inert as never);
    const { createLabFx } = await import('../src/fx/generated/labFx');
    const fx = createLabFx();
    expect(Object.keys(fx).sort()).toEqual([...new Set([...APPEAR_POOL, ...DISAPPEAR_POOL])].sort());
    for (const effect of Object.values(fx)) {
      expect(effect.appearMs).toBeGreaterThanOrEqual(1500);
      expect(effect.appearMs).toBeLessThanOrEqual(3500);
      expect(effect.disappearMs).toBeGreaterThanOrEqual(1200);
      expect(effect.disappearMs).toBeLessThanOrEqual(3000);
    }
  });
});

describe('the shuffle bag', () => {
  for (const [kind, pool] of [['appear', APPEAR_POOL], ['disappear', DISAPPEAR_POOL]] as const) {
    it(`plays every ${kind} once per bag and never the same one twice in a row`, () => {
      const random = seeded(kind.length);
      let state: BagState | undefined;
      const drawn: string[] = [];
      for (let i = 0; i < pool.length * 40; i++) {
        const next = drawFromBag(state, pool, random);
        drawn.push(next.id);
        state = next.state;
      }
      for (let b = 0; b < 40; b++) {
        expect([...drawn.slice(b * pool.length, (b + 1) * pool.length)].sort()).toEqual([...pool].sort());
      }
      for (let i = 1; i < drawn.length; i++) expect(drawn[i]).not.toBe(drawn[i - 1]);
    });
  }

  it('breaks a repeat across the bag boundary even when the shuffle lands on one', () => {
    // A generator stuck at 0 shuffles the pool the same way every time, so the
    // new bag would open with the effect that just closed the old one.
    const stuck = () => 0;
    let state: BagState | undefined;
    const drawn: string[] = [];
    for (let i = 0; i < 30; i++) {
      const next = drawFromBag(state, ['a', 'b', 'c'], stuck);
      drawn.push(next.id);
      state = next.state;
    }
    for (let i = 1; i < drawn.length; i++) expect(drawn[i]).not.toBe(drawn[i - 1]);
  });

  it('drops ids that left the pool and duplicates from a stored bag', () => {
    const next = drawFromBag({ bag: ['gone', 'a', 'a'], last: 'b' }, ['a', 'b']);
    expect(next.id).toBe('a');
    expect(next.state.bag).toEqual([]);
  });

  it('keeps its place in storage, so a reload or another tab carries on the same bag', async () => {
    const first = new FxDeck(seeded(7));
    const a = await first.next('appear');
    const b = await first.next('appear');
    // A new page: a fresh deck, the same storage.
    const second = new FxDeck(seeded(99));
    const seen = [a, b];
    for (let i = 2; i < APPEAR_POOL.length; i++) seen.push(await second.next('appear'));
    expect([...seen].sort()).toEqual([...APPEAR_POOL].sort());
    // Exits draw from their own bag.
    expect(DISAPPEAR_POOL).toContain(await second.next('disappear'));
    const saved = store.data['mrclippy:fx-bags'] as Record<FxKind, BagState>;
    expect(saved.appear.bag).toEqual([]);
    expect(saved.disappear.bag).toHaveLength(DISAPPEAR_POOL.length - 1);
  });
});

/** A stand-in for the Agent, recording what Presence asked of it. */
function fakeAgent(): PresenceAgent & { calls: string[] } {
  const calls: string[] = [];
  let visible = false;
  return {
    calls,
    get isVisible() { return visible; },
    spot: { x: 500, y: 400 },
    show(animated = true) { visible = true; calls.push(animated ? 'show:Show' : 'show:rest'); },
    hide(immediate = false) { visible = false; calls.push(immediate ? 'hide:now' : 'hide:Hide'); },
  };
}

function fakePlayer(): PresencePlayer & { played: string[] } {
  const played: string[] = [];
  return {
    played,
    supported: true,
    play: async (fx, kind, anchor) => {
      played.push(`${kind}:${fx.id}@${anchor.x},${anchor.y}`);
      return true;
    },
    cancel: () => undefined,
  };
}

const effects = (): Record<string, LabFx> => Object.fromEntries(
  [...new Set([...APPEAR_POOL, ...DISAPPEAR_POOL])].map((id) => [id, {
    id, name: id, appearMs: 2000, disappearMs: 2000, appear: () => undefined, disappear: () => undefined,
  }]),
);

describe('arriving and leaving', () => {
  it('arrives with a random entrance and leaves with a random exit, from his actual spot', async () => {
    const agent = fakeAgent();
    const player = fakePlayer();
    const arrived = vi.fn();
    const deck = new FxDeck(seeded(3));
    const presence = new Presence({
      agent, player, next: (k) => deck.next(k), effects: async () => effects(), reducedMotion: () => false, onArrived: arrived,
    });
    presence.arrive();
    await vi.waitFor(() => expect(arrived).toHaveBeenCalledWith(false, true));
    expect(agent.calls).toEqual(['show:rest']);
    expect(player.played[0]).toMatch(/^appear:(r1|r5|r4|p2|p1|c1|c4|x1|x2|x3|x4)@500,400$/);

    presence.leave();
    // His sprite steps aside the moment the exit starts; the overlay draws him from there.
    expect(agent.isVisible).toBe(false);
    await vi.waitFor(() => expect(player.played).toHaveLength(2));
    expect(agent.calls).toEqual(['show:rest', 'hide:now']);
    expect(player.played[1]).toMatch(/^disappear:(r1|r4|p2|p4|c4|x2|x3|x4)@500,400$/);
    presence.dispose();
  });

  it('comes back on his own 15 minutes after X, with an entrance', async () => {
    vi.useFakeTimers();
    const agent = fakeAgent();
    const player = fakePlayer();
    const arrived = vi.fn();
    const presence = new Presence({
      agent, player, next: async (k) => (k === 'appear' ? 'x4' : 'p4'), effects: async () => effects(),
      reducedMotion: () => false, onArrived: arrived,
    });
    presence.arrive();
    await vi.advanceTimersByTimeAsync(0);
    presence.leave();
    await vi.advanceTimersByTimeAsync(0);
    expect(agent.isVisible).toBe(false);

    await vi.advanceTimersByTimeAsync(RETURN_AFTER_MS - 1_000);
    expect(agent.isVisible).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(agent.isVisible).toBe(true);
    expect(arrived).toHaveBeenLastCalledWith(true, true);
    expect(player.played).toEqual(['appear:x4@500,400', 'disappear:p4@500,400', 'appear:x4@500,400']);
    presence.dispose();
  });

  it('comes back right away when summoned, and the 15 minute clock stops', async () => {
    vi.useFakeTimers();
    const agent = fakeAgent();
    const player = fakePlayer();
    const presence = new Presence({ agent, player, next: async () => 'x3', effects: async () => effects(), reducedMotion: () => false });
    presence.arrive();
    await vi.advanceTimersByTimeAsync(0);
    presence.leave();
    await vi.advanceTimersByTimeAsync(0);
    presence.arrive();
    await vi.advanceTimersByTimeAsync(0);
    expect(agent.isVisible).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    presence.dispose();
  });

  it('finishes the effect in flight, then does whatever was asked last', async () => {
    const agent = fakeAgent();
    let landEntrance!: () => void;
    const played: string[] = [];
    const player: PresencePlayer = {
      supported: true,
      play: (_fx, kind) => {
        played.push(kind);
        return kind === 'appear' && played.length === 1
          ? new Promise((r) => { landEntrance = () => r(true); })
          : Promise.resolve(true);
      },
      cancel: () => undefined,
    };
    const presence = new Presence({ agent, player, next: async () => 'x2', effects: async () => effects(), reducedMotion: () => false });
    presence.arrive();
    await vi.waitFor(() => expect(played).toEqual(['appear']));
    presence.toggle(); // the shortcut, mid-entrance
    expect(presence.here).toBe(false);
    landEntrance();
    await vi.waitFor(() => expect(played).toEqual(['appear', 'disappear']));
    await vi.waitFor(() => expect(agent.isVisible).toBe(false));
    presence.dispose();
  });

  it('plays the plain Show and Hide, on the spot, when the reader asks for less motion', () => {
    const agent = fakeAgent();
    const player = fakePlayer();
    const arrived = vi.fn();
    const presence = new Presence({
      agent, player, next: async () => 'x1', effects: async () => effects(), reducedMotion: () => true, onArrived: arrived,
    });
    presence.arrive();
    // Synchronous: no effect to wait for.
    expect(agent.calls).toEqual(['show:Show']);
    expect(arrived).toHaveBeenCalledWith(false, false);
    presence.leave();
    expect(agent.calls).toEqual(['show:Show', 'hide:Hide']);
    expect(player.played).toEqual([]);
    presence.dispose();
  });

  it('still arrives if an effect breaks', async () => {
    const agent = fakeAgent();
    const player: PresencePlayer = { supported: true, play: async () => { throw new Error('boom'); }, cancel: () => undefined };
    const presence = new Presence({ agent, player, next: async () => 'r1', effects: async () => effects(), reducedMotion: () => false });
    presence.arrive();
    await vi.waitFor(() => expect(agent.isVisible).toBe(true));
    presence.dispose();
  });
});

describe('the player', () => {
  it('steps t at the lab frame rate, ends exactly on time, then stops its loop and clears the stage', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const ctx = {
      setTransform: vi.fn(), clearRect: vi.fn(), imageSmoothingEnabled: true,
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as never);
    const host = document.createElement('div');
    const player = new FxPlayer(host);
    const seen: number[] = [];
    const fx: LabFx = {
      id: 'x9', name: 'test', appearMs: 1000, disappearMs: 1000, fps: 20,
      appear: (_c, t, stage) => { seen.push(t); expect(stage.anchor).toEqual({ x: 10, y: 20 }); },
      disappear: () => undefined,
    };
    const done = player.play(fx, 'appear', { x: 10.4, y: 19.6 });
    const canvas = host.querySelector('canvas')!;
    expect(canvas.hidden).toBe(false);
    for (const now of [0, 30, 74, 520, 999]) frames.shift()!(now);
    expect(seen).toEqual([0, 0, 0.05, 0.5, 0.95]);
    frames.shift()!(1000);
    await expect(done).resolves.toBe(true);
    expect(frames).toHaveLength(0); // no more frames asked for
    expect(canvas.hidden).toBe(true);
    player.destroy();
    expect(host.querySelector('canvas')).toBeNull();
  });

  it('cuts an effect off on request', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => ({ setTransform() {}, clearRect() {} }) as never);
    const player = new FxPlayer(document.createElement('div'));
    const fx = effects().r1!;
    const done = player.play(fx, 'disappear', { x: 0, y: 0 });
    player.cancel();
    await expect(done).resolves.toBe(false);
  });
});

describe('the toolbar button', () => {
  it('asks the active tab to bring him back', async () => {
    store.query.mockResolvedValue([{ id: 42 }]);
    store.send.mockResolvedValue(undefined);
    await summonOnActiveTab('');
    expect(store.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(store.send).toHaveBeenCalledWith(42, { type: 'mrclippy:summon' });
  });

  it('does not summon from Settings opened as its own window', async () => {
    await summonOnActiveTab('?host=docs.google.com');
    expect(store.query).not.toHaveBeenCalled();
    expect(store.send).not.toHaveBeenCalled();
  });

  it('shrugs off a tab with no Clippee on it', async () => {
    store.query.mockResolvedValue([{ id: 7 }]);
    store.send.mockRejectedValue(new Error('Receiving end does not exist.'));
    await expect(summonOnActiveTab('')).resolves.toBeUndefined();
  });
});

describe('Fix all', () => {
  const thread = (changes: AgentChange[]): Thread => ({
    log: document.createElement('div'), title: 't', history: [], busy: false,
    applyAll: async () => changes, drafting: Promise.resolve(),
  });

  it('tells him to celebrate once, when fixes landed', async () => {
    const landed = vi.fn();
    const bar = fixAllBar([
      () => ({ thread: thread([{ find: 'a', replace: 'b', applied: true }]) }),
      () => ({ thread: thread([{ find: 'c', replace: 'd', applied: false, reason: 'gone' }]) }),
    ], () => undefined, landed);
    await bar.run();
    await bar.run();
    expect(landed).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when nothing landed', async () => {
    const landed = vi.fn();
    const bar = fixAllBar([
      () => ({ thread: thread([{ find: 'a', replace: 'b', applied: false, reason: 'gone' }]) }),
      () => ({ thread: thread([]) }),
    ], () => undefined, landed);
    await bar.run();
    expect(landed).not.toHaveBeenCalled();
  });
});
