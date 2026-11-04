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
  storage.syncGet.mockResolvedValue({ 'mrclippy:settings': { muted: true, apiKey: 'legacy-secret' } });
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
  await Promise.all([settings.savePreferences({ muted: true }), settings.savePreferences({ enabled: false })]);
  expect(stored).toMatchObject({ muted: true, enabled: false });
});
it('coerces corrupt preferences without trusting synced secrets or pack paths', async () => {
  storage.syncGet.mockResolvedValue({ 'mrclippy:settings': {
    enabled: 'false', muted: 1, snoozeUntil: Infinity, characterPack: '../../popup',
    disabledHosts: [123, 'docs.google.com'], apiKey: 'legacy-secret',
  } });
  expect(await settings.loadPreferences()).toMatchObject({
    enabled: true, muted: false, snoozeUntil: 0, characterPack: 'clippy',
    disabledHosts: ['docs.google.com'], apiKey: '',
  });
});
