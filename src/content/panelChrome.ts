import { QUICK_ACTIONS, type ChatPanelOptions } from './chatTypes';

/** The panel's fixed parts: the Win98 title bar and the quick-action chips. */

export function buildTitleBar(options: ChatPanelOptions): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'mrclippy-titlebar';

  const title = document.createElement('span');
  title.className = 'mrclippy-title';
  title.textContent = 'Mr. Clippy';

  const controls = document.createElement('span');
  controls.className = 'mrclippy-titlebtns';

  const settingsBtn = document.createElement('button');
  settingsBtn.type = 'button';
  settingsBtn.className = 'mrclippy-titlebtn mrclippy-titlebtn-settings';
  settingsBtn.title = 'Settings: API key, mute, snooze';
  settingsBtn.setAttribute('aria-label', 'Settings: API key, mute, snooze');
  settingsBtn.textContent = 'Settings';
  settingsBtn.addEventListener('click', () => options.onSettings());

  const quiet = document.createElement('button');
  quiet.type = 'button';
  quiet.className = 'mrclippy-titlebtn';
  quiet.title = 'Just let me write';
  quiet.setAttribute('aria-label', 'Just let me write');
  quiet.textContent = '–';
  quiet.addEventListener('click', () => options.onSnooze());

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'mrclippy-titlebtn';
  close.title = 'Close';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '✕';
  close.addEventListener('click', () => options.onClose());

  controls.append(settingsBtn, quiet, close);
  bar.append(title, controls);
  return bar;
}

export function buildChips(
  onAudit: () => void,
  onAsk: (question: string, label: string) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'mrclippy-chips';

  for (const action of QUICK_ACTIONS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'mrclippy-chip';
    chip.textContent = action.label;
    chip.addEventListener('click', () => {
      if (action.id === 'structure') onAudit();
      else onAsk(action.question, action.label);
    });
    row.appendChild(chip);
  }

  return row;
}
