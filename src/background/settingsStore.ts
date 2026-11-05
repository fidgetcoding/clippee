import { ext } from '../platform';
import { SETTINGS_FORMAT, loadPreferences } from '../settings';
import type { Preferences, SettingsMutation } from '../settingsProtocol';

// Only the worker imports this writer. All extension contexts send mutations to
// it; no popup/content read-modify-write cycle can overwrite an unrelated patch.
let tail: Promise<unknown> = Promise.resolve();
export function mutatePreferences(mutation: SettingsMutation): Promise<Preferences> {
  const pending = tail.then(async () => {
    const { apiKey: _key, workspaceId: _workspace, ...preferences } = await loadPreferences();
    Object.assign(preferences, mutation.patch);
    // Only today's fields, with the mark that says they were saved by this version.
    const saved = { ...preferences, v: SETTINGS_FORMAT };
    await ext.storage.sync.set({ 'mrclippy:settings': saved });
    return saved;
  });
  // Failed storage operations reject their caller, but do not poison later work.
  tail = pending.catch(() => undefined);
  return pending;
}
