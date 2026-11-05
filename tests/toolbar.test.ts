import { afterEach, describe, expect, it, vi } from 'vitest';

const sw = vi.hoisted(() => ({
  message: undefined as undefined | ((message: unknown, sender: object, reply: (v: unknown) => void) => boolean),
  clicked: undefined as undefined | ((tab: { id?: number; url?: string }) => void),
  updated: undefined as undefined | ((tabId: number, change: { status?: string }) => void),
  setPopup: vi.fn(async (_options: { tabId: number; popup: string }) => undefined),
  openPopup: vi.fn(async () => undefined),
  sendMessage: vi.fn(async () => undefined),
  installed: undefined as undefined | (() => void),
  connected: undefined as undefined | ((port: { name: string; disconnect: () => void }) => void),
  executeScript: vi.fn(async (_o: { target: { tabId: number; allFrames: boolean }; files: string[] }) => []),
  tabs: [] as { id: number; url: string }[],
}));
vi.mock('../src/platform', () => ({
  ext: {
    runtime: {
      onMessage: { addListener: (fn: typeof sw.message) => { sw.message = fn; } },
      sendMessage: sw.sendMessage,
      getURL: (p: string) => p,
      getManifest: () => ({ content_scripts: [
        { matches: ['*://docs.google.com/document/d/*'], js: ['assets/index.ts-loader.js'], all_frames: true },
        { matches: ['*://docs.google.com/document/*'], js: ['assets/gdocsMain.ts-loader.js'], world: 'MAIN' },
      ] }),
      onInstalled: { addListener: (fn: typeof sw.installed) => { sw.installed = fn; } },
      onConnect: { addListener: (fn: typeof sw.connected) => { sw.connected = fn; } },
    },
    scripting: { executeScript: sw.executeScript },
    action: {
      setPopup: sw.setPopup,
      openPopup: sw.openPopup,
      onClicked: { addListener: (fn: typeof sw.clicked) => { sw.clicked = fn; } },
    },
    tabs: {
      sendMessage: sw.sendMessage,
      get: async (id: number) => sw.tabs.find((t) => t.id === id) ?? { id, url: '' },
      query: async () => sw.tabs,
      onUpdated: { addListener: (fn: typeof sw.updated) => { sw.updated = fn; } },
    },
  },
}));
vi.mock('../src/settings', () => ({ loadSettings: async () => ({ apiKey: '', workspaceId: '' }) }));
vi.mock('../src/agent/client', () => ({ ask: vi.fn(), NO_KEY: 'no key', clientFor: vi.fn(), describe: () => ({ error: 'e' }) }));

import { Presence, type PresenceAgent, type PresencePlayer } from '../src/content/presence';

afterEach(() => {
  vi.useRealTimers();
  sw.setPopup.mockClear();
  sw.openPopup.mockClear();
  sw.sendMessage.mockReset().mockResolvedValue(undefined);
  sw.executeScript.mockClear();
  sw.tabs = [];
});

describe('the toolbar button', () => {
  it('turns Settings off on a tab while he is away, and back on when he returns', async () => {
    await import('../src/background/serviceWorker');
    sw.message!({ type: 'mrclippy:away', away: true }, { tab: { id: 7 } }, () => {});
    expect(sw.setPopup).toHaveBeenLastCalledWith({ tabId: 7, popup: '' });
    sw.message!({ type: 'mrclippy:away', away: false }, { tab: { id: 7 } }, () => {});
    expect(sw.setPopup).toHaveBeenLastCalledWith({ tabId: 7, popup: 'src/popup/index.html' });
    // Per tab: another tab's state never touches this one.
    sw.message!({ type: 'mrclippy:away', away: true }, { tab: { id: 9 } }, () => {});
    expect(sw.setPopup).toHaveBeenLastCalledWith({ tabId: 9, popup: '' });
    expect(sw.setPopup.mock.calls.filter(([o]) => o.tabId === 7)).toHaveLength(2);
  });

  it('a click while he is away calls him back on that tab, with no popup', async () => {
    await import('../src/background/serviceWorker');
    sw.clicked!({ id: 7, url: 'https://docs.google.com/document/d/x/edit' });
    await vi.waitFor(() => expect(sw.sendMessage).toHaveBeenCalledWith(7, { type: 'mrclippy:summon' }));
    expect(sw.openPopup).not.toHaveBeenCalled();
  });

  it('puts a fresh copy into a doc whose copy died, instead of opening Settings', async () => {
    await import('../src/background/serviceWorker');
    sw.tabs = [{ id: 7, url: 'https://docs.google.com/document/d/x/edit' }];
    sw.sendMessage.mockRejectedValueOnce(new Error('Receiving end does not exist.'));
    sw.clicked!({ id: 7, url: 'https://docs.google.com/document/d/x/edit' });
    await vi.waitFor(() => expect(sw.executeScript).toHaveBeenCalled());
    expect(sw.executeScript).toHaveBeenCalledWith({ target: { tabId: 7, allFrames: true }, files: ['assets/index.ts-loader.js'] });
    expect(sw.openPopup).not.toHaveBeenCalled();
  });

  it('opens Settings after all when the tab has no Clippee to call back', async () => {
    await import('../src/background/serviceWorker');
    sw.sendMessage.mockRejectedValueOnce(new Error('Receiving end does not exist.'));
    sw.clicked!({ id: 7, url: 'https://example.com/' });
    await vi.waitFor(() => expect(sw.openPopup).toHaveBeenCalled());
    expect(sw.setPopup).toHaveBeenCalledWith({ tabId: 7, popup: 'src/popup/index.html' });
  });

  it('puts Settings back on the button whenever the tab loads a new page', async () => {
    await import('../src/background/serviceWorker');
    sw.updated!(7, { status: 'loading' });
    expect(sw.setPopup).toHaveBeenLastCalledWith({ tabId: 7, popup: 'src/popup/index.html' });
    sw.setPopup.mockClear();
    sw.updated!(7, { status: 'complete' });
    expect(sw.setPopup).not.toHaveBeenCalled();
  });
});

function fakeAgent(): PresenceAgent {
  let visible = false;
  return {
    get isVisible() { return visible; },
    spot: { x: 0, y: 0 },
    show() { visible = true; },
    hide() { visible = false; },
  };
}
const plainPlayer: PresencePlayer = { supported: false, play: async () => false, cancel: () => undefined };

describe('coming back on his own', () => {
  it('tells the button when he leaves and when he is back', () => {
    const away = vi.fn();
    const presence = new Presence({
      agent: fakeAgent(), player: plainPlayer, next: async () => 'r1', effects: async () => ({}),
      reducedMotion: () => true, onAway: away,
    });
    presence.arrive();
    presence.leave();
    presence.arrive();
    expect(away.mock.calls.map(([a]) => a)).toEqual([false, true, false]);
    presence.dispose();
  });

  it('waits for the tab to be seen before his entrance', async () => {
    vi.useFakeTimers();
    const agent = fakeAgent();
    let seen = false;
    let wake: (() => void) | undefined;
    const presence = new Presence({
      agent, player: plainPlayer, next: async () => 'r1', effects: async () => ({}), reducedMotion: () => true,
      returnAfterMs: 1_000,
      ready: () => seen,
      watchReady: (changed) => { wake = changed; return () => { wake = undefined; }; },
    });
    presence.arrive();
    presence.leave();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(agent.isVisible).toBe(false); // Another tab, another app, or the popup is open.
    wake?.(); // Something changed, but still not seen.
    expect(agent.isVisible).toBe(false);
    seen = true;
    wake?.();
    expect(agent.isVisible).toBe(true);
    expect(wake).toBeUndefined(); // Stopped watching once he's back.
    presence.dispose();
  });

  it('comes straight back when the tab is already seen', async () => {
    vi.useFakeTimers();
    const agent = fakeAgent();
    const presence = new Presence({
      agent, player: plainPlayer, next: async () => 'r1', effects: async () => ({}), reducedMotion: () => true,
      returnAfterMs: 1_000, ready: () => true, watchReady: () => () => undefined,
    });
    presence.arrive();
    presence.leave();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(agent.isVisible).toBe(true);
    presence.dispose();
  });
});

describe('a fresh copy of him', () => {
  it('goes in when Settings asks, his own scripts only, never the Docs reader that must start with the page', async () => {
    await import('../src/background/serviceWorker');
    sw.tabs = [{ id: 7, url: 'https://docs.google.com/document/d/x/edit' }];
    const reply = vi.fn();
    expect(sw.message!({ type: 'mrclippy:inject', tabId: 7 }, {}, reply)).toBe(true);
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith({ ok: true, error: '' }));
    expect(sw.executeScript).toHaveBeenCalledTimes(1);
    expect(sw.executeScript.mock.calls[0]![0].files).toEqual(['assets/index.ts-loader.js']);
  });

  it('is refused to a page that asks for it', async () => {
    await import('../src/background/serviceWorker');
    expect(sw.message!({ type: 'mrclippy:inject', tabId: 7 }, { tab: { id: 7 } }, () => {})).toBe(false);
    expect(sw.executeScript).not.toHaveBeenCalled();
  });

  it('goes into every open doc when the extension is installed, updated or reloaded', async () => {
    await import('../src/background/serviceWorker');
    sw.tabs = [
      { id: 1, url: 'https://docs.google.com/document/d/a/edit' },
      { id: 2, url: 'https://mail.google.com/' },
      { id: 3, url: 'https://docs.google.com/document/d/b/edit' },
    ];
    sw.installed!();
    await vi.waitFor(() => expect(sw.executeScript).toHaveBeenCalledTimes(2));
    expect(sw.executeScript.mock.calls.map(([o]) => o.target.tabId)).toEqual([1, 3]);
  });

  it('keeps each page\'s port open so a dead copy hears about it', async () => {
    await import('../src/background/serviceWorker');
    const ours = { name: 'mrclippy:page', disconnect: vi.fn() };
    const stranger = { name: 'other', disconnect: vi.fn() };
    sw.connected!(ours);
    sw.connected!(stranger);
    expect(ours.disconnect).not.toHaveBeenCalled();
    expect(stranger.disconnect).toHaveBeenCalled();
  });
});
