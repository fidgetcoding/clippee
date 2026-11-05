import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  stored: {} as Record<string, unknown>,
  local: { 'mrclippy:apiKey': 'local-secret' } as Record<string, unknown>,
  listener: undefined as undefined | ((message: unknown, sender: object, reply: (value: unknown) => void) => boolean),
  syncGet: vi.fn(), syncSet: vi.fn(), localGet: vi.fn(), localSet: vi.fn(),
  replies: [] as unknown[], messages: [] as unknown[],
}));
vi.mock('../src/platform', () => ({ hasExtensionApis: () => true, ext: {
  storage: {
    sync: { get: state.syncGet, set: state.syncSet },
    local: { get: state.localGet, set: state.localSet },
  },
  runtime: {
    onMessage: { addListener: (fn: typeof state.listener) => { state.listener = fn; } },
    sendMessage: (message: unknown) => new Promise((resolve, reject) => {
      state.messages.push(message);
      const accepted = state.listener?.(message, { tab: { id: 1 }, url: 'https://docs.google.com/document/test' }, (reply) => {
        state.replies.push(reply); resolve(reply);
      });
      if (!accepted) reject(new Error('Message not handled'));
    }),
  },
} }));
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  state.stored = {}; state.local = { 'mrclippy:apiKey': 'local-secret' }; state.replies = []; state.messages = [];
  state.syncGet.mockImplementation(async () => ({ 'mrclippy:settings': { ...state.stored } }));
  state.syncSet.mockImplementation(async (data) => { state.stored = data['mrclippy:settings']; });
  state.localGet.mockImplementation(async () => ({ ...state.local }));
  state.localSet.mockImplementation(async (data) => { Object.assign(state.local, data); });
  await import('../src/background/serviceWorker');
});
it('preserves unrelated saves from independent content and popup module contexts', async () => {
  vi.resetModules();
  const content = await import('../src/settings');
  vi.resetModules();
  const popup = await import('../src/settings');
  expect(content).not.toBe(popup);
  const [preferences] = await Promise.all([
    content.savePreferences({ muted: true }),
    popup.saveSettings({ snoozeUntil: 5 }),
  ]);
  expect(state.stored).toMatchObject({ muted: true, snoozeUntil: 5 });
  expect(preferences.apiKey).toBe('');
});

it('rejects malformed mutation messages once without storage writes or credential leakage', async () => {
  const malformed = [
    undefined, null, [], {}, { kind: 'unknown' },
    { kind: 'patch', patch: { muted: 'false' } },
    // Switches Settings no longer has are refused, not stored.
    { kind: 'patch', patch: { enabled: false } },
    { kind: 'patch', patch: { disabledHosts: ['docs.google.com'] } },
    { kind: 'patch', patch: { debugMode: true } },
    { kind: 'patch', patch: { soundEnabled: true } },
    { kind: 'patch', patch: { snoozeUntil: Infinity } },
    { kind: 'patch', patch: { characterPack: '../popup' } },
    { kind: 'patch', patch: { apiKey: 'injected-key' } },
    { kind: 'patch', patch: { workspaceId: 'injected-workspace' } },
    { kind: 'patch', patch: { unknown: true } },
    { kind: 'toggle-host', hostname: 'docs.google.com' },
    { kind: 'toggle-muted' },
  ];
  for (const mutation of malformed) {
    const reply = vi.fn();
    state.listener!({ type: 'mrclippy:settings', mutation }, {}, reply);
    expect(reply).toHaveBeenCalledExactlyOnceWith({ ok: false, error: 'Invalid settings mutation.' });
  }
  expect(state.syncGet).not.toHaveBeenCalled();
  expect(state.syncSet).not.toHaveBeenCalled();
  expect(state.localGet).not.toHaveBeenCalled();
  const settings = await import('../src/settings');
  await settings.savePreferences({ muted: true });
  expect(state.stored.muted).toBe(true);
});

it('replies to a failed storage read and continues queued mutations', async () => {
  const settings = await import('../src/settings');
  state.syncGet.mockRejectedValueOnce(new Error('Storage unavailable: local-secret'));
  const results = await Promise.allSettled([
    settings.savePreferences({ snoozeUntil: 9 }), settings.savePreferences({ muted: true }),
  ]);
  expect(results[0]).toMatchObject({ status: 'rejected', reason: new Error('Could not save settings. Try again.') });
  expect(results[1]!.status).toBe('fulfilled');
  expect(state.stored).toMatchObject({ snoozeUntil: 0, muted: true });
  expect(state.replies).toHaveLength(2);
  expect(JSON.stringify(state.replies)).not.toContain('local-secret');
});

it('replies to a failed storage write and continues queued mutations', async () => {
  const settings = await import('../src/settings');
  state.syncSet.mockRejectedValueOnce(new Error('Storage unavailable'));
  const results = await Promise.allSettled([
    settings.savePreferences({ snoozeUntil: 9 }), settings.savePreferences({ muted: true }),
  ]);
  expect(results[0]!.status).toBe('rejected');
  expect(results[1]!.status).toBe('fulfilled');
  expect(state.stored).toMatchObject({ snoozeUntil: 0, muted: true });
  expect(state.replies).toHaveLength(2);
});

it('keeps credentials out of preference requests and responses', async () => {
  const settings = await import('../src/settings');
  const patch = { muted: true, apiKey: 'content-injection', workspaceId: 'content-workspace' };
  const result = await settings.savePreferences(patch);
  expect(result.apiKey).toBe('');
  expect(result.workspaceId).toBe('');
  expect(state.localGet).not.toHaveBeenCalled();
  expect(state.localSet).not.toHaveBeenCalled();
  expect(state.messages).toEqual([{ type: 'mrclippy:settings', mutation: { kind: 'patch', patch: { muted: true } } }]);
  expect(JSON.stringify(state.replies)).not.toMatch(/apiKey|workspaceId|secret|injection/);
  expect(state.stored).not.toHaveProperty('apiKey');
  expect(state.stored).not.toHaveProperty('workspaceId');
});

it('preserves separate local credential fields without sending either through preference messages', async () => {
  vi.resetModules(); const firstPage = await import('../src/settings');
  vi.resetModules(); const secondPage = await import('../src/settings');
  await Promise.all([
    firstPage.saveSettings({ apiKey: 'replacement-key', muted: true }),
    secondPage.saveSettings({ workspaceId: 'replacement-workspace', snoozeUntil: 7 }),
  ]);
  expect(state.local).toMatchObject({ 'mrclippy:apiKey': 'replacement-key', 'mrclippy:workspaceId': 'replacement-workspace' });
  expect(state.stored).toMatchObject({ muted: true, snoozeUntil: 7 });
  expect(JSON.stringify(state.messages)).not.toMatch(/replacement-key|replacement-workspace/);
  expect(JSON.stringify(state.replies)).not.toMatch(/replacement-key|replacement-workspace/);
});
