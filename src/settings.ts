import { ext, hasExtensionApis } from './platform';
import type { Preferences, SettingsMutation } from './settingsProtocol';

/**
 * User controls.
 *
 * These are not a nice-to-have. The controls people reach for before
 * uninstalling — mute, snooze, not-on-this-site — are the difference between an
 * assistant they tolerate on a bad day and one they remove. Every one of them
 * has to work without opening a settings page, which is why the popup is three
 * toggles and a slider rather than a preferences tree.
 */
export interface Settings {
  /** Master switch. Off means the character does not mount at all. */
  enabled: boolean;
  /** Proactive suggestions suppressed; explicit clicks still answer. */
  muted: boolean;
  /** Epoch ms. Muted until this passes. */
  snoozeUntil: number;
  /** Hostnames where Clippee stays away entirely. */
  disabledHosts: string[];
  /** Frames the character but plays no sounds by default. */
  soundEnabled: boolean;
  /**
   * Testing aid: drops the ten-minute rate cap and the fifteen-second silence
   * floor so suggestions surface immediately. Ships off — with it on, Clippee is
   * exactly the eager assistant the research says people dislike.
   */
  debugMode: boolean;
  /** Character pack directory name under `src/packs/`. */
  characterPack: string;
  /**
   * Anthropic API key. Read only by the background worker — a content script
   * shares a DOM with the page it is injected into and must never hold this.
   */
  apiKey: string;
  /**
   * Anthropic workspace ID, sent as `anthropic-workspace-id`. Only needed for a
   * key that is not scoped to a workspace; the API rejects those without it.
   */
  workspaceId: string;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  enabled: true,
  muted: false,
  snoozeUntil: 0,
  disabledHosts: [],
  soundEnabled: false,
  debugMode: false,
  characterPack: 'clippy',
  apiKey: '',
  workspaceId: '',
};

const KEY = 'mrclippy:settings';
const SECRET_KEY = 'mrclippy:apiKey';
const WORKSPACE_KEY = 'mrclippy:workspaceId';

export const SNOOZE_DURATIONS_MS = {
  '15 minutes': 15 * 60_000,
  '1 hour': 60 * 60_000,
  'Rest of today': 8 * 60 * 60_000,
} as const;

function coerce(raw: unknown): Settings {
  if (raw === null || typeof raw !== 'object') return { ...DEFAULT_SETTINGS, disabledHosts: [] };
  const value = raw as Partial<Settings>;
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_SETTINGS.enabled,
    muted: typeof value.muted === 'boolean' ? value.muted : DEFAULT_SETTINGS.muted,
    snoozeUntil: typeof value.snoozeUntil === 'number' && Number.isFinite(value.snoozeUntil)
      ? Math.max(0, value.snoozeUntil) : 0,
    disabledHosts: Array.isArray(value.disabledHosts)
      ? value.disabledHosts.filter((h): h is string => typeof h === 'string') : [],
    soundEnabled: typeof value.soundEnabled === 'boolean' ? value.soundEnabled : DEFAULT_SETTINGS.soundEnabled,
    debugMode: typeof value.debugMode === 'boolean' ? value.debugMode : DEFAULT_SETTINGS.debugMode,
    characterPack: typeof value.characterPack === 'string' && /^[a-z0-9][a-z0-9_-]*$/i.test(value.characterPack)
      ? value.characterPack : DEFAULT_SETTINGS.characterPack,
    apiKey: '',
    workspaceId: '',
  };
}

/** Content scripts read preferences only; credentials stay in extension pages/worker. */
export async function loadPreferences(): Promise<Settings> {
  if (!hasExtensionApis()) return { ...DEFAULT_SETTINGS, disabledHosts: [] };
  const stored = await ext.storage.sync.get(KEY);
  return coerce(stored[KEY]);
}

export async function loadSettings(): Promise<Settings> {
  if (!hasExtensionApis()) return { ...DEFAULT_SETTINGS, disabledHosts: [] };
  // Preferences sync across the user's machines; the API key deliberately does
  // not — `storage.sync` is replicated through the browser account.
  const [synced, local] = await Promise.all([
    ext.storage.sync.get(KEY),
    ext.storage.local.get([SECRET_KEY, WORKSPACE_KEY]),
  ]);
  const settings = coerce(synced[KEY]);
  const apiKey = typeof local[SECRET_KEY] === 'string' ? local[SECRET_KEY] : '';
  const workspaceId = typeof local[WORKSPACE_KEY] === 'string' ? local[WORKSPACE_KEY] : '';
  return { ...settings, apiKey, workspaceId };
}

/** Extension pages alone call this credential-aware API. */
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const { apiKey, workspaceId, ...preferences } = patch;
  if ((apiKey !== undefined && typeof apiKey !== 'string') ||
      (workspaceId !== undefined && typeof workspaceId !== 'string')) throw new Error('Invalid credentials.');
  if (Object.keys(preferences).length > 0) await savePreferences(preferences);
  // Keys use independent local storage entries, never a synced settings snapshot
  // or a content-facing worker response. Combine a credential patch in one write.
  const local: Record<string, string> = {};
  if (apiKey !== undefined) local[SECRET_KEY] = apiKey;
  if (workspaceId !== undefined) local[WORKSPACE_KEY] = workspaceId;
  if (hasExtensionApis() && Object.keys(local).length > 0) await ext.storage.local.set(local);
  return loadSettings();
}

export function savePreferences(patch: Partial<Preferences>): Promise<Settings> {
  // Strip credentials even if an untyped content caller supplies them.
  const { apiKey: _key, workspaceId: _workspace, ...preferences } = patch as Partial<Settings>;
  return requestMutation({ kind: 'patch', patch: preferences });
}

async function requestMutation(mutation: SettingsMutation): Promise<Settings> {
  const response: unknown = await ext.runtime.sendMessage({ type: 'mrclippy:settings', mutation });
  if (!response || typeof response !== 'object') throw new Error('No reply while saving settings.');
  const reply = response as { ok?: unknown; preferences?: unknown; error?: unknown };
  if (reply.ok !== true) throw new Error(typeof reply.error === 'string' ? reply.error : 'Could not save settings.');
  if (!reply.preferences || typeof reply.preferences !== 'object' || Array.isArray(reply.preferences)) {
    throw new Error('Invalid settings reply.');
  }
  return coerce(reply.preferences);
}

/** Read-modify-write toggles are evaluated inside the worker's shared queue. */
export function toggleMuted(): Promise<Settings> {
  return requestMutation({ kind: 'toggle-muted' });
}

export function onSettingsChanged(listener: (settings: Settings) => void): () => void {
  if (!hasExtensionApis()) return () => {};
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ): void => {
    if (area !== 'sync' || !changes[KEY]) return;
    listener(coerce(changes[KEY].newValue));
  };
  ext.storage.onChanged.addListener(handler);
  return () => ext.storage.onChanged.removeListener(handler);
}

/** Should Clippee appear on this host at all? */
export function isActiveOn(settings: Settings, hostname: string): boolean {
  if (!settings.enabled) return false;
  return !settings.disabledHosts.includes(hostname);
}

/** Muted right now — explicitly, or because a snooze is still running. */
export function isSilenced(settings: Settings, now = Date.now()): boolean {
  return settings.muted || settings.snoozeUntil > now;
}

export async function snooze(durationMs: number): Promise<Settings> {
  return saveSettings({ snoozeUntil: Date.now() + durationMs });
}

export function toggleHost(hostname: string): Promise<Settings> {
  return requestMutation({ kind: 'toggle-host', hostname });
}
