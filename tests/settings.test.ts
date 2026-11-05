import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  isSilenced,
  type Settings,
} from '../src/settings';

function make(patch: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...patch };
}

describe('silence', () => {
  it('is not silenced by default', () => {
    expect(isSilenced(make(), 1_000)).toBe(false);
  });

  it('is silenced while muted', () => {
    expect(isSilenced(make({ muted: true }), 1_000)).toBe(true);
  });

  it('is silenced until the snooze expires, then is not', () => {
    const settings = make({ snoozeUntil: 5_000 });
    expect(isSilenced(settings, 4_999)).toBe(true);
    expect(isSilenced(settings, 5_000)).toBe(false);
    expect(isSilenced(settings, 9_999)).toBe(false);
  });

  it('leaves an expired snooze harmless rather than needing a cleanup pass', () => {
    expect(isSilenced(make({ snoozeUntil: 1 }), Date.now())).toBe(false);
  });
});

describe('defaults', () => {
  it('has no switches left that could keep him off, loud or in test mode', () => {
    expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual(['apiKey', 'characterPack', 'muted', 'snoozeUntil', 'workspaceId']);
    expect(DEFAULT_SETTINGS.muted).toBe(false);
  });
});
