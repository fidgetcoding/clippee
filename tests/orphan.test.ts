import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  id: 'live-extension-id' as string | undefined,
  addListener: vi.fn(), removeListener: vi.fn(),
  disconnect: [] as (() => void)[],
  connect: vi.fn(),
  watchers: new Set<unknown>(),
}));
vi.mock('../src/platform', () => ({
  hasExtensionApis: () => true,
  ext: {
    storage: {
      sync: { get: async () => ({}) },
      local: { get: async () => ({}), set: async () => {} },
      onChanged: { addListener: (fn: unknown) => state.watchers.add(fn), removeListener: (fn: unknown) => state.watchers.delete(fn) },
    },
    runtime: {
      get id() { return state.id; },
      sendMessage: async () => ({ hasKey: true }),
      connect: state.connect,
      onMessage: { addListener: state.addListener, removeListener: state.removeListener },
    },
  },
}));
vi.mock('../src/content/surfaces', () => ({ isWritingSurface: () => true }));
vi.mock('../src/content/documentSource', () => ({ resolveSource: () => ({
  id: 'test', context: () => 'doc', matches: () => true, read: async () => 'Some text.', canEdit: () => true,
  replace: async () => ({ applied: false, reason: 'unavailable' }), select: async () => false, boxes: () => [],
}) }));
vi.mock('../src/character/packLoader', () => ({ loadPack: async () => ({ name: 'test', spriteUrl: 'map.png',
  data: { overlayCount: 1, framesize: [10, 10], sounds: [], animations: {} } }) }));

beforeEach(() => {
  vi.resetModules();
  state.id = 'live-extension-id';
  state.disconnect = [];
  state.watchers.clear();
  state.addListener.mockReset();
  state.removeListener.mockReset();
  state.connect.mockReset().mockImplementation(() => ({
    onDisconnect: { addListener: (fn: () => void) => state.disconnect.push(fn) },
  }));
});
afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  document.querySelector('#mrclippy-host')?.remove();
  vi.useRealTimers();
});

it('takes itself down when the extension is reloaded under it, host, listeners and timers', async () => {
  vi.useFakeTimers();
  await import('../src/content/index');
  await vi.waitFor(() => expect(document.querySelector('#mrclippy-host')).not.toBeNull());
  expect(state.connect).toHaveBeenCalledWith({ name: 'mrclippy:page' });
  // The extension is reloaded: the port drops and the runtime id is gone.
  state.id = undefined;
  state.disconnect.forEach((fn) => fn());
  expect(document.querySelector('#mrclippy-host')).toBeNull();
  expect(state.removeListener).toHaveBeenCalled();
  expect(state.watchers.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it('only reconnects when the worker merely went to sleep', async () => {
  vi.useFakeTimers();
  await import('../src/content/index');
  await vi.waitFor(() => expect(document.querySelector('#mrclippy-host')).not.toBeNull());
  state.disconnect.forEach((fn) => fn()); // id still there: the worker slept
  expect(document.querySelector('#mrclippy-host')).not.toBeNull();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(state.connect).toHaveBeenCalledTimes(2);
});

it('answers Settings: where he is, and Show and Hide outright', async () => {
  await import('../src/content/index');
  await vi.waitFor(() => expect(document.querySelector('#mrclippy-host')).not.toBeNull());
  const message = state.addListener.mock.calls[0]![0] as (m: unknown, s: unknown, reply: (r: unknown) => void) => void;
  const ask = (type: string): unknown => {
    let answer: unknown;
    message({ type }, {}, (r) => { answer = r; });
    return answer;
  };
  const agent = () => document.querySelector('#mrclippy-host')!.shadowRoot!.querySelector<HTMLElement>('.mrclippy-agent')!;
  expect(ask('mrclippy:presence')).toEqual({ here: true });
  expect(ask('mrclippy:force-hide')).toEqual({ here: false });
  expect(agent().hidden).toBe(true);
  expect(ask('mrclippy:presence')).toEqual({ here: false });
  expect(ask('mrclippy:force-show')).toEqual({ here: true });
  expect(agent().hidden).toBe(false);
});
