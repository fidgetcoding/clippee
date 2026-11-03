import { ext, hasExtensionApis } from './platform';

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
  /** Hostnames where Mr. Clippy stays away entirely. */
  disabledHosts: string[];
  /** Frames the character but plays no sounds by default. */
  soundEnabled: boolean;
  /**
   * Testing aid: drops the ten-minute rate cap and the fifteen-second silence
   * floor so suggestions surface immediately. Ships off — with it on, Mr. Clippy is
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
  if (raw === null || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const value = raw as Partial<Settings>;
  return {
    enabled: value.enabled ?? DEFAULT_SETTINGS.enabled,
    muted: value.muted ?? DEFAULT_SETTINGS.muted,
    snoozeUntil: typeof value.snoozeUntil === 'number' ? value.snoozeUntil : 0,
    disabledHosts: Array.isArray(value.disabledHosts) ? value.disabledHosts : [],
    soundEnabled: value.soundEnabled ?? DEFAULT_SETTINGS.soundEnabled,
    debugMode: value.debugMode ?? DEFAULT_SETTINGS.debugMode,
    characterPack: value.characterPack ?? DEFAULT_SETTINGS.characterPack,
    apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
    workspaceId: '',
  };
}

export async function loadSettings(): Promise<Settings> {
  if (!hasExtensionApis()) return { ...DEFAULT_SETTINGS };
  // Preferences sync across the user's machines; the API key deliberately does
  // not — `storage.sync` is replicated through the browser account.
  const [synced, local] = await Promise.all([
    ext.storage.sync.get(KEY),
    ext.storage.local.get([SECRET_KEY, WORKSPACE_KEY]),
  ]);
  const settings = coerce(synced[KEY]);
  const apiKey = (local[SECRET_KEY] ?? '') as string;
  const workspaceId = (local[WORKSPACE_KEY] ?? '') as string;
  return { ...settings, apiKey, workspaceId };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const next: Settings = { ...current, ...patch };
  if (!hasExtensionApis()) return next;

  const { apiKey, workspaceId, ...preferences } = next;
  await ext.storage.sync.set({ [KEY]: { ...preferences, apiKey: '', workspaceId: '' } });
  if (patch.apiKey !== undefined) await ext.storage.local.set({ [SECRET_KEY]: apiKey });
  if (patch.workspaceId !== undefined) {
    await ext.storage.local.set({ [WORKSPACE_KEY]: workspaceId });
  }
  return next;
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

/** Should Mr. Clippy appear on this host at all? */
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

export async function toggleHost(hostname: string): Promise<Settings> {
  const current = await loadSettings();
  const disabled = current.disabledHosts.includes(hostname);
  return saveSettings({
    disabledHosts: disabled
      ? current.disabledHosts.filter((h) => h !== hostname)
      : [...current.disabledHosts, hostname],
  });
}
