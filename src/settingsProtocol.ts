import type { Settings } from './settings';

export type Preferences = Omit<Settings, 'apiKey' | 'workspaceId'>;
export type SettingsMutation = { kind: 'patch'; patch: Partial<Preferences> };
export type SettingsResponse =
  | { ok: true; preferences: Preferences }
  | { ok: false; error: string };

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Copy only explicitly supported fields. Credentials never enter this protocol. */
export function parseSettingsMutation(value: unknown): SettingsMutation | undefined {
  if (!record(value)) return undefined;
  if (value.kind !== 'patch' || Object.keys(value).length !== 2 || !record(value.patch)) return undefined;
  const patch: Partial<Preferences> = {};
  for (const [key, entry] of Object.entries(value.patch)) {
    switch (key) {
      case 'muted':
        if (typeof entry !== 'boolean') return undefined;
        patch.muted = entry; break;
      case 'snoozeUntil':
        if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0) return undefined;
        patch.snoozeUntil = entry; break;
      case 'characterPack':
        if (typeof entry !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(entry)) return undefined;
        patch.characterPack = entry; break;
      default: return undefined;
    }
  }
  return { kind: 'patch', patch };
}
