import { ext } from '../platform';
import { loadPreferences } from '../settings';
import type { Preferences, SettingsMutation } from '../settingsProtocol';

// Only the worker imports this writer. All extension contexts send mutations to
// it; no popup/content read-modify-write cycle can overwrite an unrelated patch.
let tail: Promise<unknown> = Promise.resolve();
export function mutatePreferences(mutation: SettingsMutation): Promise<Preferences> {
  const pending = tail.then(async () => {
    const { apiKey: _key, workspaceId: _workspace, ...preferences } = await loadPreferences();
    if (mutation.kind === 'patch') Object.assign(preferences, mutation.patch);
    else if (mutation.kind === 'toggle-muted') preferences.muted = !preferences.muted;
    else {
      const hosts = new Set(preferences.disabledHosts);
      if (hosts.has(mutation.hostname)) hosts.delete(mutation.hostname);
      else hosts.add(mutation.hostname);
      preferences.disabledHosts = [...hosts];
    }
    await ext.storage.sync.set({ 'mrclippy:settings': preferences });
    return preferences;
  });
  // Failed storage operations reject their caller, but do not poison later work.
  tail = pending.catch(() => undefined);
  return pending;
}
