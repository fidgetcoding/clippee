import { beforeEach, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => ({ syncGet: vi.fn(), localGet: vi.fn(), syncSet: vi.fn(), localSet: vi.fn() }));
vi.mock('../src/platform', () => ({ hasExtensionApis: () => true, ext: {
  runtime: { sendMessage: async ({ mutation }: { mutation: import('../src/settingsProtocol').SettingsMutation }) => {
    const { mutatePreferences } = await import('../src/background/settingsStore');
    return { ok: true, preferences: await mutatePreferences(mutation) };
  } },
  storage: {
  sync: { get: storage.syncGet, set: storage.syncSet },
  local: { get: storage.localGet, set: storage.localSet },
} } }));
import * as settings from '../src/settings';
beforeEach(() => {
  vi.clearAllMocks();
  storage.syncGet.mockResolvedValue({ 'mrclippy:settings': { v: 2, muted: true, apiKey: 'legacy-secret' } });
  storage.localGet.mockResolvedValue({ 'mrclippy:apiKey': 'local-secret' });
  storage.syncSet.mockResolvedValue(undefined);
});
it('reads and saves content preferences without ever loading a secret', async () => {
  const preferences = await settings.loadPreferences();
  expect(preferences.muted).toBe(true);
  expect(preferences.apiKey).toBe('');
  await settings.savePreferences({ muted: false });
  expect(storage.localGet).not.toHaveBeenCalled();
  expect(storage.localSet).not.toHaveBeenCalled();
  expect(JSON.stringify(storage.syncSet.mock.calls)).not.toContain('secret');
});
it('preserves both simultaneous preference changes', async () => {
  let stored: Record<string, unknown> = {};
  storage.syncGet.mockImplementation(async () => ({ 'mrclippy:settings': { ...stored } }));
  storage.syncSet.mockImplementation(async (data) => { stored = data['mrclippy:settings']; });
  await Promise.all([settings.savePreferences({ muted: true }), settings.savePreferences({ snoozeUntil: 3 })]);
  expect(stored).toMatchObject({ muted: true, snoozeUntil: 3, v: 2 });
});
it('coerces corrupt preferences without trusting synced secrets or pack paths', async () => {
  storage.syncGet.mockResolvedValue({ 'mrclippy:settings': {
    v: 2, muted: 1, snoozeUntil: Infinity, characterPack: '../../popup', apiKey: 'legacy-secret',
  } });
  expect(await settings.loadPreferences()).toEqual({
    muted: false, snoozeUntil: 0, characterPack: 'clippee', apiKey: '', workspaceId: '',
  });
});
it('never leaves an old install stuck: its master switch, site switches, test mode, sound and mute are dropped', async () => {
  // Saved by a version whose Settings had those switches. None of them has a switch any more.
  storage.syncGet.mockResolvedValue({ 'mrclippy:settings': {
    enabled: false, muted: true, disabledHosts: ['docs.google.com'], soundEnabled: true, debugMode: true,
    snoozeUntil: 0, characterPack: 'clippee',
  } });
  expect(await settings.loadPreferences()).toEqual({
    muted: false, snoozeUntil: 0, characterPack: 'clippee', apiKey: '', workspaceId: '',
  });
  // The next save writes only today's fields, so the old ones are gone for good.
  let stored: Record<string, unknown> = {};
  storage.syncSet.mockImplementation(async (data) => { stored = data['mrclippy:settings']; });
  await settings.savePreferences({ snoozeUntil: 0 });
  expect(stored).toEqual({ muted: false, snoozeUntil: 0, characterPack: 'clippee', v: 2 });
});
it('keeps a mute asked for in the chat since Settings shrank', async () => {
  let stored: Record<string, unknown> = {};
  storage.syncGet.mockImplementation(async () => ({ 'mrclippy:settings': { ...stored } }));
  storage.syncSet.mockImplementation(async (data) => { stored = data['mrclippy:settings']; });
  const saved = await settings.savePreferences({ muted: true });
  expect(saved.muted).toBe(true);
  expect((await settings.loadPreferences()).muted).toBe(true);
});
