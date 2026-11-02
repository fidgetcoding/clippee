import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  isActiveOn,
  isSilenced,
  type Settings,
} from '../src/settings';

function make(patch: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...patch };
}

describe('activation', () => {
  it('is on by default', () => {
    expect(isActiveOn(make(), 'docs.google.com')).toBe(true);
  });

  it('respects the master switch', () => {
    expect(isActiveOn(make({ enabled: false }), 'docs.google.com')).toBe(false);
  });

  it('stays away from a disabled host without affecting others', () => {
    const settings = make({ disabledHosts: ['mail.google.com'] });
    expect(isActiveOn(settings, 'mail.google.com')).toBe(false);
    expect(isActiveOn(settings, 'docs.google.com')).toBe(true);
  });
});

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
  it('ships quiet: no sound, no test mode', () => {
    // Test mode drops the rate cap, which makes him exactly the eager assistant
    // the research says people dislike. It must never be the default.
    expect(DEFAULT_SETTINGS.debugMode).toBe(false);
    expect(DEFAULT_SETTINGS.soundEnabled).toBe(false);
  });
});
