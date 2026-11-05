import { ext } from '../platform';
import {
  SNOOZE_DURATIONS_MS,
  isSilenced,
  loadSettings,
  saveSettings,
  snooze,
  toggleHost,
  type Settings,
} from '../settings';
import { summonOnActiveTab } from './summon';

const DISMISSAL_KEY = 'mrclippy:dismissals';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

async function currentHost(): Promise<string | undefined> {
  // Opened from Clippy as its own window: the page it came from rides along.
  const passed = new URLSearchParams(location.search).get('host');
  if (passed) return passed;
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return undefined;
  try {
    return new URL(tab.url).hostname;
  } catch {
    return undefined;
  }
}

function describe(settings: Settings, host: string | undefined): string {
  if (!settings.enabled) return 'Off';
  if (host && settings.disabledHosts.includes(host)) return `Off on ${host}`;
  if (settings.muted) return 'Muted — click him to ask';
  if (settings.snoozeUntil > Date.now()) {
    const minutes = Math.ceil((settings.snoozeUntil - Date.now()) / 60_000);
    return `Snoozed ${minutes} more minute${minutes === 1 ? '' : 's'}`;
  }
  if (settings.debugMode) return 'Test mode — no rate limit';
  return 'Watching';
}

function paint(settings: Settings, host: string | undefined): void {
  el<HTMLInputElement>('enabled').checked = settings.enabled;
  el<HTMLInputElement>('muted').checked = settings.muted;
  el<HTMLInputElement>('sound').checked = settings.soundEnabled;
  el<HTMLInputElement>('debug').checked = settings.debugMode;

  const hostToggle = el<HTMLInputElement>('host-enabled');
  hostToggle.checked = host ? !settings.disabledHosts.includes(host) : false;
  hostToggle.disabled = !host;
  el('host').textContent = host ?? 'no site';

  el('status').textContent = describe(settings, host);

  const silenced = isSilenced(settings);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-snooze]')) {
    button.setAttribute('aria-pressed', String(silenced && settings.snoozeUntil > Date.now()));
  }
}

async function main(): Promise<void> {
  void summonOnActiveTab();
  const host = await currentHost();
  let settings = await loadSettings();
  paint(settings, host);

  const keyField = el<HTMLInputElement>('apikey');
  const keyHint = el('apikey-hint');
  keyField.value = settings.apiKey;
  const keySection = el('apikey-section');
  const markMissing = (): void => {
    keySection.toggleAttribute('data-missing', settings.apiKey.length === 0);
  };
  markMissing();
  if (!settings.apiKey) keyField.focus();

  const workspaceField = el<HTMLInputElement>('workspace');
  workspaceField.value = settings.workspaceId;
  if (settings.workspaceId) workspaceField.closest('details')?.setAttribute('open', '');
  const persistWorkspace = (): void => {
    const workspaceId = workspaceField.value.trim();
    if (workspaceId === settings.workspaceId) return;
    void saveSettings({ workspaceId }).then((next) => {
      settings = next;
    });
  };
  workspaceField.addEventListener('blur', persistWorkspace);
  workspaceField.addEventListener('change', persistWorkspace);

  // Save on blur rather than per keystroke — writing a partial key on every
  // character would leave a truncated secret in storage between keys.
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const persistKey = (): void => {
    const apiKey = keyField.value.trim();
    if (apiKey === settings.apiKey) return;
    void saveSettings({ apiKey }).then((next) => {
      settings = next;
      markMissing();
      keyHint.textContent = apiKey ? 'Saved. Go ask him something.' : 'Cleared.';
      keyHint.dataset.state = 'saved';
      if (saveTimer !== undefined) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        keyHint.textContent = 'Needed to chat with him. Stored on this machine only, never synced.';
        delete keyHint.dataset.state;
      }, 2_500);
    });
  };

  keyField.addEventListener('blur', persistKey);
  // A paste is the whole key at once, and the popup can close before blur fires.
  keyField.addEventListener('paste', () => setTimeout(persistKey, 0));
  keyField.addEventListener('change', persistKey);

  const bind = (id: string, key: keyof Settings): void => {
    el<HTMLInputElement>(id).addEventListener('change', (event) => {
      const checked = (event.target as HTMLInputElement).checked;
      void saveSettings({ [key]: checked } as Partial<Settings>).then((next) => {
        settings = next;
        paint(settings, host);
      });
    });
  };

  bind('enabled', 'enabled');
  bind('muted', 'muted');
  bind('sound', 'soundEnabled');
  bind('debug', 'debugMode');

  el<HTMLInputElement>('host-enabled').addEventListener('change', () => {
    if (!host) return;
    void toggleHost(host).then((next) => {
      // The worker's preference reply deliberately contains no credentials.
      settings = { ...next, apiKey: settings.apiKey, workspaceId: settings.workspaceId };
      paint(settings, host);
    });
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-snooze]')) {
    button.addEventListener('click', () => {
      const label = button.dataset.snooze as keyof typeof SNOOZE_DURATIONS_MS;
      const duration = SNOOZE_DURATIONS_MS[label];
      if (duration === undefined) return;
      void snooze(duration).then((next) => {
        settings = next;
        paint(settings, host);
      });
    });
  }

  el<HTMLButtonElement>('reset-dismissals').addEventListener('click', (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    void ext.storage.local.remove(DISMISSAL_KEY).then(() => {
      button.textContent = 'Forgotten. He gets another go.';
      setTimeout(() => {
        button.textContent = "Forget what I've dismissed";
      }, 2_000);
    });
  });
}

void main().catch((error: unknown) => {
  const status = document.getElementById('status');
  if (status) status.textContent = error instanceof Error ? error.message : 'Something went wrong';
});
