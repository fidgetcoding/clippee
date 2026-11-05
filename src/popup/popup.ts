import {
  loadSettings,
  saveSettings,
  type Settings,
} from '../settings';
import { askTab, isHisPage, setPresence, targetTab, type TabPresence } from './presenceButton';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

/** The line under the name. "Snoozed" only ever means a snooze somebody asked for. */
function describe(settings: Settings): string {
  if (settings.muted) return 'Muted. Say "unmute" in his chat to undo.';
  if (settings.snoozeUntil > Date.now()) {
    const minutes = Math.ceil((settings.snoozeUntil - Date.now()) / 60_000);
    return `Snoozed ${minutes} more minute${minutes === 1 ? '' : 's'}`;
  }
  return 'Watching';
}

/** Show Clippee / Hide Clippee, for the doc in front of you. */
async function wirePresence(): Promise<void> {
  const button = el<HTMLButtonElement>('presence');
  const hint = el('presence-hint');
  const say = (text: string): void => {
    hint.textContent = text;
    hint.hidden = text === '';
  };
  const tab = await targetTab();
  if (tab?.id === undefined || !isHisPage(tab.url)) {
    button.disabled = true;
    say('Open a Google Doc and he\u2019ll be there.');
    return;
  }
  const tabId = tab.id;
  let state: TabPresence = await askTab(tabId);
  const paint = (): void => {
    const here = state !== 'missing' && state.here;
    button.textContent = here ? 'Hide Clippee' : 'Show Clippee';
    button.disabled = false;
  };
  paint();
  button.addEventListener('click', () => {
    const show = state === 'missing' || !state.here;
    button.disabled = true;
    void setPresence(tabId, show, state)
      .then((next) => {
        state = next;
        say('');
      })
      .catch(() => say('Couldn\u2019t reach that tab. Reload it and try again.'))
      .finally(paint);
  });
}

async function main(): Promise<void> {
  void wirePresence().catch(() => undefined);
  let settings = await loadSettings();
  el('status').textContent = describe(settings);

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
}

void main().catch((error: unknown) => {
  const status = document.getElementById('status');
  if (status) status.textContent = error instanceof Error ? error.message : 'Something went wrong';
});
