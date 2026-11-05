import { afterEach, describe, expect, it, vi } from 'vitest';

const ext = vi.hoisted(() => ({
  tabsSend: vi.fn(),
  runtimeSend: vi.fn(),
  query: vi.fn(),
  manifest: { content_scripts: [{ matches: ['*://docs.google.com/document/d/*'], js: ['assets/loader.js'] }] },
}));
vi.mock('../src/platform', () => ({
  ext: {
    tabs: { sendMessage: ext.tabsSend, query: ext.query },
    runtime: { sendMessage: ext.runtimeSend, getManifest: () => ext.manifest },
  },
}));

import { Presence, STUCK_AFTER_MS, type PresenceAgent, type PresencePlayer } from '../src/content/presence';
import { askTab, isHisPage, matchesPattern, setPresence, targetTab } from '../src/popup/presenceButton';
import type { LabFx } from '../src/fx/types';

afterEach(() => {
  vi.useRealTimers();
  ext.tabsSend.mockReset();
  ext.runtimeSend.mockReset();
  ext.query.mockReset();
});

function fakeAgent(): PresenceAgent & { calls: string[] } {
  const calls: string[] = [];
  let visible = false;
  return {
    calls,
    get isVisible() { return visible; },
    spot: { x: 0, y: 0 },
    show(animated = true) { visible = true; calls.push(animated ? 'show:Show' : 'show:rest'); },
    hide(immediate = false) { visible = false; calls.push(immediate ? 'hide:now' : 'hide:Hide'); },
  };
}
const fx: Record<string, LabFx> = {
  r1: { id: 'r1', name: 'r1', appearMs: 1000, disappearMs: 1000, appear: () => {}, disappear: () => {} },
};

describe('Show and Hide in Settings', () => {
  it('shows him when he is away, at rest, with no effect to wait on', () => {
    const agent = fakeAgent();
    const presence = new Presence({ agent, player: { supported: true, play: async () => true, cancel: () => {} },
      next: async () => 'r1', effects: async () => fx, reducedMotion: () => false });
    presence.force('present');
    expect(agent.isVisible).toBe(true);
    expect(presence.here).toBe(true);
    expect(agent.calls.at(-1)).toBe('show:rest');
    presence.dispose();
  });

  it('hides him when he is there, and he still comes back later as a rule', async () => {
    vi.useFakeTimers();
    const agent = fakeAgent();
    const presence = new Presence({ agent, player: { supported: false, play: async () => false, cancel: () => {} },
      next: async () => 'r1', effects: async () => fx, reducedMotion: () => true, returnAfterMs: 1_000 });
    presence.arrive();
    presence.force('away');
    expect(agent.isVisible).toBe(false);
    expect(presence.here).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(agent.isVisible).toBe(true);
    presence.dispose();
  });

  it('recovers from an effect that never finishes, and the stale effect can never land', async () => {
    const agent = fakeAgent();
    let finishStale!: (done: boolean) => void;
    const cancel = vi.fn();
    const player: PresencePlayer = {
      supported: true,
      play: () => new Promise((resolve) => { finishStale = resolve; }), // stuck: never resolves on its own
      cancel,
    };
    const presence = new Presence({ agent, player, next: async () => 'r1', effects: async () => fx, reducedMotion: () => false });
    presence.arrive();
    await vi.waitFor(() => expect(finishStale).toBeDefined());
    expect(agent.isVisible).toBe(false); // mid-entrance, wedged
    presence.force('away');
    expect(cancel).toHaveBeenCalled();
    finishStale(true); // the old entrance finally reports back
    await new Promise((r) => setTimeout(r, 0));
    expect(agent.isVisible).toBe(false); // ...and is ignored
    presence.force('present');
    expect(agent.isVisible).toBe(true);
    presence.dispose();
  });

  it('treats an effect still running long after any could as stuck, so the next request goes through', async () => {
    let now = 0;
    const agent = fakeAgent();
    const player: PresencePlayer = { supported: true, play: () => new Promise(() => {}), cancel: () => {} };
    const presence = new Presence({ agent, player, next: async () => 'r1', effects: async () => fx,
      reducedMotion: () => false, now: () => now });
    presence.arrive();
    await new Promise((r) => setTimeout(r, 0));
    presence.leave();
    presence.arrive(); // still within the effect's time: waits its turn
    expect(agent.isVisible).toBe(false);
    now = STUCK_AFTER_MS + 1;
    presence.arrive();
    expect(agent.isVisible).toBe(true);
    presence.dispose();
  });
});

describe('the Settings button and the tab', () => {
  it('knows his pages from the manifest', () => {
    expect(matchesPattern('https://docs.google.com/document/d/abc/edit', '*://docs.google.com/document/d/*')).toBe(true);
    expect(matchesPattern('https://docs.google.com/spreadsheets/d/abc', '*://docs.google.com/document/d/*')).toBe(false);
    expect(matchesPattern('https://x.notion.site/page', 'https://*.notion.site/*')).toBe(true);
    expect(isHisPage('chrome://extensions/')).toBe(false);
  });

  it('opened from Options, it finds the doc you used last', async () => {
    ext.query.mockImplementation(async (q: object) => ('active' in q
      ? [{ id: 1, url: 'chrome://extensions/?options=x' }]
      : [{ id: 2, url: 'https://docs.google.com/document/d/a/edit', lastAccessed: 5 },
         { id: 3, url: 'https://docs.google.com/document/d/b/edit', lastAccessed: 9 },
         { id: 4, url: 'https://example.com/', lastAccessed: 99 }]));
    expect((await targetTab())?.id).toBe(3);
  });

  it('asks the tab, and reads no answer as no live Clippee there', async () => {
    ext.tabsSend.mockResolvedValueOnce({ here: false });
    expect(await askTab(7)).toEqual({ here: false });
    ext.tabsSend.mockRejectedValueOnce(new Error('Receiving end does not exist.'));
    expect(await askTab(7)).toBe('missing');
  });

  it('Show and Hide go to the tab as force-resets', async () => {
    ext.tabsSend.mockResolvedValueOnce({ here: true });
    expect(await setPresence(7, true, { here: false })).toEqual({ here: true });
    expect(ext.tabsSend).toHaveBeenLastCalledWith(7, { type: 'mrclippy:force-show' });
    ext.tabsSend.mockResolvedValueOnce({ here: false });
    expect(await setPresence(7, false, { here: true })).toEqual({ here: false });
    expect(ext.tabsSend).toHaveBeenLastCalledWith(7, { type: 'mrclippy:force-hide' });
    expect(ext.runtimeSend).not.toHaveBeenCalled();
  });

  it('with no live copy on the tab, the worker puts one in', async () => {
    ext.runtimeSend.mockResolvedValue({ ok: true });
    expect(await setPresence(7, true, 'missing')).toEqual({ here: true });
    expect(ext.runtimeSend).toHaveBeenCalledWith({ type: 'mrclippy:inject', tabId: 7 });
    expect(ext.tabsSend).not.toHaveBeenCalled();
    // A copy that dies between the popup opening and the click: same.
    ext.tabsSend.mockRejectedValueOnce(new Error('Extension context invalidated.'));
    expect(await setPresence(7, true, { here: false })).toEqual({ here: true });
    expect(ext.runtimeSend).toHaveBeenCalledTimes(2);
  });
});
