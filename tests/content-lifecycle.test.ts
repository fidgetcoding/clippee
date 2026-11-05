import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  read: vi.fn<() => Promise<string | undefined>>(),
  addListener: vi.fn(), removeListener: vi.fn(), context: 'first',
  syncGet: vi.fn(), loadPack: vi.fn(), sendMessage: vi.fn(), sourceDispose: vi.fn(),
  watchers: new Set<(changes: object, area: string) => void>(),
}));
vi.mock('../src/platform', () => ({
  hasExtensionApis: () => true,
  ext: {
    storage: {
      sync: { get: state.syncGet },
      local: { get: async () => ({}), set: async () => {} },
      onChanged: { addListener: (fn: (changes: object, area: string) => void) => state.watchers.add(fn),
        removeListener: (fn: (changes: object, area: string) => void) => state.watchers.delete(fn) },
    },
    runtime: { sendMessage: state.sendMessage,
      onMessage: { addListener: state.addListener, removeListener: state.removeListener } },
  },
}));
vi.mock('../src/content/surfaces', () => ({ isWritingSurface: () => true }));
vi.mock('../src/content/documentSource', () => ({ resolveSource: () => ({
  id: 'test', context: () => state.context, matches: () => true, read: state.read, canEdit: () => true,
  replace: async () => ({ applied: false, reason: 'unavailable' }),
  select: async () => false, boxes: () => [], dispose: state.sourceDispose,
}) }));
vi.mock('../src/character/packLoader', () => ({ loadPack: state.loadPack }));
const testPack = { name: 'test', spriteUrl: 'map.png',
  data: { overlayCount: 1, framesize: [10, 10], sounds: [], animations: {} } };
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); state.context = 'first';
  state.watchers.clear(); state.syncGet.mockReset().mockResolvedValue({});
  state.loadPack.mockReset().mockResolvedValue(testPack);
  state.sendMessage.mockReset().mockResolvedValue({ hasKey: true });
});
afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  document.querySelector('#mrclippy-host')?.remove();
  vi.useRealTimers();
});
it('keeps the panel closed when an earlier document read finishes late', async () => {
  vi.useFakeTimers();
  let finish!: (text: string) => void;
  state.read.mockImplementation(() => new Promise((r) => { finish = r; }));
  await import('../src/content/index');
  await vi.waitFor(() => expect(document.querySelector('#mrclippy-host')?.shadowRoot?.querySelector('.mrclippy-agent')).toBeTruthy());
  const root = document.querySelector('#mrclippy-host')!.shadowRoot!;
  const agent = root.querySelector('.mrclippy-agent')!;
  const click = () => agent.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  click(); // close greeting
  click(); // begin reading
  expect(state.read).toHaveBeenCalledTimes(1);
  click(); // close while read is pending
  finish('The document is ready.');
  await vi.advanceTimersByTimeAsync(1);
  expect((root.querySelector('.mrclippy-balloon') as HTMLElement).hidden).toBe(true);
  expect(root.querySelector('.mrclippy-panel')).toBeNull();
});
it('shows a freshly reviewed suggestion at the first quiet seam', async () => {
  vi.useFakeTimers();
  state.read.mockResolvedValue(('At the end of the day we finish. At the end of the day we rest. ' +
    'The team has time to write and review the report. ').repeat(4));
  await import('../src/content/index');
  await vi.waitFor(() => expect(document.querySelector('#mrclippy-host')?.shadowRoot?.querySelector('.mrclippy-agent')).toBeTruthy());
  await vi.advanceTimersByTimeAsync(17000);
  const root = document.querySelector('#mrclippy-host')!.shadowRoot!;
  expect(root.querySelector('.mrclippy-nudge')).not.toBeNull();
});
it('does not attach old findings to an editor selected during the opening read', async () => {
  vi.useFakeTimers();
  let finish!: (text: string) => void;
  state.read.mockImplementation(() => new Promise((r) => { finish = r; }));
  await import('../src/content/index');
  await vi.waitFor(() => expect(document.querySelector('#mrclippy-host')?.shadowRoot?.querySelector('.mrclippy-agent')).toBeTruthy());
  const root = document.querySelector('#mrclippy-host')!.shadowRoot!;
  const click = () => root.querySelector('.mrclippy-agent')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  click(); click();
  state.context = 'second';
  finish('Text from the first editor.');
  await vi.advanceTimersByTimeAsync(1);
  expect(root.querySelector('.mrclippy-panel')).toBeNull();
});

function changeSettings(next: Record<string, unknown>): void {
  for (const watcher of state.watchers) watcher({ 'mrclippy:settings': { newValue: next } }, 'sync');
}
it('mounts when enabled after starting with the master switch off', async () => {
  vi.useFakeTimers();
  state.syncGet.mockResolvedValue({ 'mrclippy:settings': { enabled: false } });
  await import('../src/content/index');
  await vi.advanceTimersByTimeAsync(1);
  expect(document.querySelector('#mrclippy-host')).toBeNull();
  changeSettings({ enabled: true });
  await vi.waitFor(() => expect(document.querySelector('#mrclippy-host')?.shadowRoot?.querySelector('.mrclippy-agent')).toBeTruthy());
});

it('restarts across host off/on and master off/on without duplicating the page listeners', async () => {
  vi.useFakeTimers();
  state.syncGet.mockResolvedValue({ 'mrclippy:settings': { disabledHosts: [location.hostname] } });
  await import('../src/content/index');
  await vi.advanceTimersByTimeAsync(1);
  expect(document.querySelector('#mrclippy-host')).toBeNull();
  for (const off of [{ disabledHosts: [location.hostname] }, { enabled: false }]) {
    changeSettings({ enabled: true, disabledHosts: [] });
    await vi.waitFor(() => expect(document.querySelector('#mrclippy-host')).not.toBeNull());
    const previous = document.querySelector('#mrclippy-host')!;
    changeSettings(off);
    expect(previous.isConnected).toBe(false);
    expect(state.watchers.size).toBe(1);
  }
  changeSettings({ enabled: true, disabledHosts: [] });
  await vi.waitFor(() => expect(document.querySelectorAll('#mrclippy-host')).toHaveLength(1));
  expect(state.addListener).toHaveBeenCalledTimes(1);
  expect(state.removeListener).not.toHaveBeenCalled();
  expect(state.sourceDispose).toHaveBeenCalledTimes(2);
});

it('discards superseded asynchronous startups during rapid master toggles', async () => {
  vi.useFakeTimers();
  let finishOld!: (pack: typeof testPack) => void;
  let finishNew!: (pack: typeof testPack) => void;
  state.loadPack.mockImplementationOnce(() => new Promise((r) => { finishOld = r; }))
    .mockImplementationOnce(() => new Promise((r) => { finishNew = r; }));
  await import('../src/content/index');
  await vi.waitFor(() => expect(state.loadPack).toHaveBeenCalledTimes(1));
  changeSettings({ enabled: false });
  changeSettings({ enabled: true });
  await vi.waitFor(() => expect(state.loadPack).toHaveBeenCalledTimes(2));
  finishNew(testPack);
  await vi.waitFor(() => expect(document.querySelector('#mrclippy-host')).not.toBeNull());
  const current = document.querySelector('#mrclippy-host');
  finishOld(testPack);
  await vi.advanceTimersByTimeAsync(1);
  expect(document.querySelector('#mrclippy-host')).toBe(current);
  expect(document.querySelectorAll('#mrclippy-host')).toHaveLength(1);
  expect(state.addListener).toHaveBeenCalledTimes(1);
  expect(state.sourceDispose).not.toHaveBeenCalled();
});

it('finally disposes the page owner while startup is still pending', async () => {
  vi.useFakeTimers();
  let finish!: (pack: typeof testPack) => void;
  state.loadPack.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  await import('../src/content/index');
  await vi.waitFor(() => expect(state.loadPack).toHaveBeenCalledTimes(1));
  const staleWatcher = [...state.watchers][0]!;
  const staleMessage = state.addListener.mock.calls[0]![0];
  window.dispatchEvent(new Event('pagehide'));
  expect(state.watchers.size).toBe(0);
  expect(state.removeListener).toHaveBeenCalledExactlyOnceWith(staleMessage);
  staleWatcher({ 'mrclippy:settings': { newValue: { enabled: true } } }, 'sync');
  staleMessage({ type: 'mrclippy:toggle' });
  finish(testPack);
  await vi.advanceTimersByTimeAsync(1);
  expect(document.querySelector('#mrclippy-host')).toBeNull();
  expect(state.loadPack).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('finally disposes a mounted runtime and never restarts it on page events', async () => {
  vi.useFakeTimers();
  await import('../src/content/index');
  await vi.waitFor(() => expect(document.querySelector('#mrclippy-host')).not.toBeNull());
  window.dispatchEvent(new Event('pagehide'));
  window.dispatchEvent(new Event('pagehide'));
  window.dispatchEvent(new Event('popstate'));
  changeSettings({ enabled: true });
  await vi.advanceTimersByTimeAsync(1);
  expect(document.querySelector('#mrclippy-host')).toBeNull();
  expect(state.sourceDispose).toHaveBeenCalledTimes(1);
  expect(state.removeListener).toHaveBeenCalledTimes(1);
  expect(state.watchers.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it('ignores an old initial preference read after a newer settings event', async () => {
  vi.useFakeTimers();
  let finish!: (value: object) => void;
  state.syncGet.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  await import('../src/content/index');
  expect(state.watchers.size).toBe(1);
  changeSettings({ enabled: false });
  finish({ 'mrclippy:settings': { enabled: true } });
  await vi.advanceTimersByTimeAsync(1);
  expect(state.loadPack).not.toHaveBeenCalled();
  changeSettings({ enabled: true });
  await vi.waitFor(() => expect(document.querySelector('#mrclippy-host')).not.toBeNull());
});

it('restarts an asynchronous startup against the new URL without mounting the old document', async () => {
  vi.useFakeTimers();
  const oldUrl = location.href;
  let finishOld!: (pack: typeof testPack) => void;
  let finishNew!: (pack: typeof testPack) => void;
  state.loadPack.mockImplementationOnce(() => new Promise((r) => { finishOld = r; }))
    .mockImplementationOnce(() => new Promise((r) => { finishNew = r; }));
  try {
    await import('../src/content/index');
    await vi.waitFor(() => expect(state.loadPack).toHaveBeenCalledTimes(1));
    history.replaceState(null, '', '#new-document');
    finishOld(testPack);
    await vi.waitFor(() => expect(state.loadPack).toHaveBeenCalledTimes(2));
    expect(document.querySelector('#mrclippy-host')).toBeNull();
    finishNew(testPack);
    await vi.waitFor(() => expect(document.querySelectorAll('#mrclippy-host')).toHaveLength(1));
  } finally { history.replaceState(null, '', oldUrl); }
});

it('keeps close-X hidden when its snooze update and unrelated settings arrive', async () => {
  vi.useFakeTimers();
  state.sendMessage.mockImplementation(async (message) => {
    if (message.type !== 'mrclippy:settings') return { hasKey: true };
    changeSettings(message.mutation.patch);
    return { ok: true, preferences: message.mutation.patch };
  });
  await import('../src/content/index');
  await vi.waitFor(() => expect(document.querySelector('#mrclippy-host')).not.toBeNull());
  const host = document.querySelector('#mrclippy-host')!;
  const agent = host.shadowRoot!.querySelector<HTMLElement>('.mrclippy-agent')!;
  host.shadowRoot!.querySelector<HTMLButtonElement>('.mrclippy-agent-close')!.click();
  await vi.advanceTimersByTimeAsync(1);
  expect(agent.hidden).toBe(true);
  const mutation = state.sendMessage.mock.calls.find(([m]) => m.type === 'mrclippy:settings')![0].mutation;
  // Quiet for exactly as long as he is gone: he comes back in 5 minutes.
  expect(mutation.patch.snoozeUntil).toBeGreaterThan(Date.now() + 4 * 60_000);
  expect(mutation.patch.snoozeUntil).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
  changeSettings({ muted: true, snoozeUntil: mutation.patch.snoozeUntil });
  await vi.advanceTimersByTimeAsync(10000);
  expect(document.querySelector('#mrclippy-host')).toBe(host);
  expect(agent.hidden).toBe(true);
  expect(state.loadPack).toHaveBeenCalledTimes(1);
});

it('restores a mounted runtime after a persisted pagehide/pageshow pair', async () => {
  vi.useFakeTimers();
  await import('../src/content/index');
  await vi.waitFor(() => expect(document.querySelector('#mrclippy-host')).not.toBeNull());
  const previous = document.querySelector('#mrclippy-host');
  window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
  expect(document.querySelector('#mrclippy-host')).toBeNull();
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  await vi.waitFor(() => expect(document.querySelector('#mrclippy-host')).not.toBeNull());
  expect(document.querySelector('#mrclippy-host')).not.toBe(previous);
  expect(state.syncGet).toHaveBeenCalledTimes(2);
  expect(state.addListener).toHaveBeenCalledTimes(1);
  expect(state.removeListener).not.toHaveBeenCalled();
  expect(state.watchers.size).toBe(1);
});

it('invalidates pending startup while frozen and starts fresh after restoration', async () => {
  vi.useFakeTimers();
  let finishOld!: (pack: typeof testPack) => void;
  let finishNew!: (pack: typeof testPack) => void;
  state.loadPack.mockImplementationOnce(() => new Promise((r) => { finishOld = r; }))
    .mockImplementationOnce(() => new Promise((r) => { finishNew = r; }));
  await import('../src/content/index');
  await vi.waitFor(() => expect(state.loadPack).toHaveBeenCalledTimes(1));
  window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
  finishOld(testPack);
  changeSettings({ enabled: true });
  state.addListener.mock.calls[0]![0]({ type: 'mrclippy:toggle' });
  await vi.advanceTimersByTimeAsync(1);
  expect(document.querySelector('#mrclippy-host')).toBeNull();
  expect(state.loadPack).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  await vi.waitFor(() => expect(state.loadPack).toHaveBeenCalledTimes(2));
  finishNew(testPack);
  await vi.waitFor(() => expect(document.querySelectorAll('#mrclippy-host')).toHaveLength(1));
  expect(state.syncGet).toHaveBeenCalledTimes(2);
});

it('rereads disabled and host-blocked preferences before restoring a runtime', async () => {
  vi.useFakeTimers();
  await import('../src/content/index');
  await vi.waitFor(() => expect(document.querySelector('#mrclippy-host')).not.toBeNull());
  for (const blocked of [{ enabled: false }, { disabledHosts: [location.hostname] }]) {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    state.syncGet.mockResolvedValue({ 'mrclippy:settings': blocked });
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    await vi.advanceTimersByTimeAsync(1);
    expect(document.querySelector('#mrclippy-host')).toBeNull();
    changeSettings({ enabled: true, disabledHosts: [] });
    await vi.waitFor(() => expect(document.querySelectorAll('#mrclippy-host')).toHaveLength(1));
  }
  expect(state.syncGet).toHaveBeenCalledTimes(3);
  expect(state.addListener).toHaveBeenCalledTimes(1);
});

it('discards an initial settings read that completes after a BFCache restore begins', async () => {
  vi.useFakeTimers();
  let finishInitial!: (settings: object) => void;
  let finishRestore!: (settings: object) => void;
  state.syncGet.mockImplementationOnce(() => new Promise((r) => { finishInitial = r; }))
    .mockImplementationOnce(() => new Promise((r) => { finishRestore = r; }));
  await import('../src/content/index');
  window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  finishInitial({ 'mrclippy:settings': { enabled: true } });
  await vi.advanceTimersByTimeAsync(1);
  expect(state.loadPack).not.toHaveBeenCalled();
  finishRestore({ 'mrclippy:settings': { enabled: false } });
  await vi.advanceTimersByTimeAsync(1);
  expect(state.loadPack).not.toHaveBeenCalled();
  expect(document.querySelector('#mrclippy-host')).toBeNull();
});

it('ignores out-of-order restore reads across repeated cache cycles', async () => {
  vi.useFakeTimers();
  await import('../src/content/index');
  await vi.waitFor(() => expect(document.querySelector('#mrclippy-host')).not.toBeNull());
  let first!: (settings: object) => void;
  let second!: (settings: object) => void;
  state.syncGet.mockImplementationOnce(() => new Promise((r) => { first = r; }))
    .mockImplementationOnce(() => new Promise((r) => { second = r; }));
  for (let cycle = 0; cycle < 2; cycle++) {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  }
  expect(state.syncGet).toHaveBeenCalledTimes(3);
  second({ 'mrclippy:settings': { enabled: false } });
  first({ 'mrclippy:settings': { enabled: true } });
  await vi.advanceTimersByTimeAsync(1);
  expect(document.querySelector('#mrclippy-host')).toBeNull();
  changeSettings({ enabled: true });
  await vi.waitFor(() => expect(document.querySelectorAll('#mrclippy-host')).toHaveLength(1));
  expect(state.loadPack).toHaveBeenCalledTimes(2);
  expect(state.addListener).toHaveBeenCalledTimes(1);
  expect(state.watchers.size).toBe(1);
});

it('lets a newer settings event supersede a pending restore read', async () => {
  vi.useFakeTimers();
  await import('../src/content/index');
  await vi.waitFor(() => expect(document.querySelector('#mrclippy-host')).not.toBeNull());
  let finish!: (settings: object) => void;
  state.syncGet.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  changeSettings({ disabledHosts: [location.hostname] });
  finish({ 'mrclippy:settings': { enabled: true, disabledHosts: [] } });
  await vi.advanceTimersByTimeAsync(1);
  expect(document.querySelector('#mrclippy-host')).toBeNull();
  expect(state.loadPack).toHaveBeenCalledTimes(1);
});

it('removes restore listeners at final disposal and cannot revive from late reads or events', async () => {
  vi.useFakeTimers();
  const add = vi.spyOn(window, 'addEventListener');
  const remove = vi.spyOn(window, 'removeEventListener');
  try {
    await import('../src/content/index');
    await vi.waitFor(() => expect(document.querySelector('#mrclippy-host')).not.toBeNull());
    for (let cycle = 0; cycle < 2; cycle++) {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      await vi.waitFor(() => expect(document.querySelectorAll('#mrclippy-host')).toHaveLength(1));
    }
    let finish!: (settings: object) => void;
    state.syncGet.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    finish({ 'mrclippy:settings': { enabled: true } });
    await vi.advanceTimersByTimeAsync(1);
    expect(document.querySelector('#mrclippy-host')).toBeNull();
    expect(state.loadPack).toHaveBeenCalledTimes(3);
    expect(state.watchers.size).toBe(0);
    expect(state.removeListener).toHaveBeenCalledTimes(1);
    for (const name of ['pagehide', 'pageshow', 'popstate', 'hashchange']) {
      const registrations = add.mock.calls.filter(([type]) => type === name);
      expect(registrations).toHaveLength(1);
      expect(remove).toHaveBeenCalledWith(name, registrations[0]![1]);
    }
    expect(vi.getTimerCount()).toBe(0);
  } finally { add.mockRestore(); remove.mockRestore(); }
});

it('restores close-X as hidden without a greeting or renewed snooze writes', async () => {
  vi.useFakeTimers();
  let saved: Record<string, unknown> = {};
  state.sendMessage.mockImplementation(async (message) => {
    if (message.type !== 'mrclippy:settings') return { hasKey: true };
    saved = message.mutation.patch;
    changeSettings(saved);
    return { ok: true, preferences: saved };
  });
  state.syncGet.mockImplementation(async () => ({ 'mrclippy:settings': saved }));
  await import('../src/content/index');
  await vi.waitFor(() => expect(document.querySelector('#mrclippy-host')).not.toBeNull());
  document.querySelector('#mrclippy-host')!.shadowRoot!.querySelector<HTMLButtonElement>('.mrclippy-agent-close')!.click();
  await vi.advanceTimersByTimeAsync(1);
  const originalSnooze = saved.snoozeUntil;
  for (let cycle = 0; cycle < 2; cycle++) {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    await vi.waitFor(() => expect(document.querySelector('#mrclippy-host')).not.toBeNull());
    const root = document.querySelector('#mrclippy-host')!.shadowRoot!;
    expect(root.querySelector<HTMLElement>('.mrclippy-agent')!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('.mrclippy-balloon')!.hidden).toBe(true);
  }
  expect(saved.snoozeUntil).toBe(originalSnooze);
  expect(state.sendMessage.mock.calls.filter(([m]) => m.type === 'mrclippy:settings')).toHaveLength(1);
});

it('preserves shortcut-hidden intent across restore and still allows an explicit show', async () => {
  vi.useFakeTimers();
  await import('../src/content/index');
  await vi.waitFor(() => expect(document.querySelector('#mrclippy-host')).not.toBeNull());
  const toggle = state.addListener.mock.calls[0]![0];
  toggle({ type: 'mrclippy:toggle' });
  window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  await vi.waitFor(() => expect(document.querySelector('#mrclippy-host')).not.toBeNull());
  const agent = document.querySelector('#mrclippy-host')!.shadowRoot!.querySelector<HTMLElement>('.mrclippy-agent')!;
  expect(agent.hidden).toBe(true);
  toggle({ type: 'mrclippy:toggle' });
  expect(agent.hidden).toBe(false);
  expect(state.addListener).toHaveBeenCalledTimes(1);
});

it('applies a snooze changed while frozen before proactive work resumes', async () => {
  vi.useFakeTimers();
  await import('../src/content/index');
  await vi.waitFor(() => expect(document.querySelector('#mrclippy-host')).not.toBeNull());
  window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
  state.read.mockClear();
  state.syncGet.mockResolvedValue({ 'mrclippy:settings': { snoozeUntil: Date.now() + 60000 } });
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  await vi.waitFor(() => expect(document.querySelector('#mrclippy-host')).not.toBeNull());
  await vi.advanceTimersByTimeAsync(17000);
  expect(state.read).not.toHaveBeenCalled();
  expect(document.querySelector('#mrclippy-host')!.shadowRoot!.querySelector('.mrclippy-nudge')).toBeNull();
});

it('comes back on his own 5 minutes after X', async () => {
  vi.useFakeTimers();
  await import('../src/content/index');
  await vi.waitFor(() => expect(document.querySelector('#mrclippy-host')).not.toBeNull());
  const root = document.querySelector('#mrclippy-host')!.shadowRoot!;
  const agent = root.querySelector<HTMLElement>('.mrclippy-agent')!;
  root.querySelector<HTMLButtonElement>('.mrclippy-agent-close')!.click();
  await vi.advanceTimersByTimeAsync(4 * 60_000);
  expect(agent.hidden).toBe(true);
  await vi.advanceTimersByTimeAsync(2 * 60_000);
  expect(agent.hidden).toBe(false);
});

it('comes back at once when the toolbar popup summons him, and ignores it while he is here', async () => {
  vi.useFakeTimers();
  await import('../src/content/index');
  await vi.waitFor(() => expect(document.querySelector('#mrclippy-host')).not.toBeNull());
  const message = state.addListener.mock.calls[0]![0];
  const root = document.querySelector('#mrclippy-host')!.shadowRoot!;
  const agent = root.querySelector<HTMLElement>('.mrclippy-agent')!;
  message({ type: 'mrclippy:summon' });
  expect(agent.hidden).toBe(false);
  root.querySelector<HTMLButtonElement>('.mrclippy-agent-close')!.click();
  await vi.advanceTimersByTimeAsync(1);
  expect(agent.hidden).toBe(true);
  message({ type: 'mrclippy:summon' });
  expect(agent.hidden).toBe(false);
  // The summon replaced the 5 minute return: nothing brings him back twice.
  await vi.advanceTimersByTimeAsync(15 * 60_000);
  expect(agent.hidden).toBe(false);
});
