import mark16 from '../icons/icon-16.png?inline';
import mark32 from '../icons/icon-32.png?inline';
import { QUICK_ACTIONS, type ChatPanelOptions } from './chatTypes';

/**
 * The panel's fixed parts, in the Windows 98 idiom: navy gradient ribbons,
 * etched group boxes, sunken wells, bevel buttons. Small builders so the
 * panel and the cards read as layout, not DOM plumbing.
 */

export function button(label: string, className = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `mrclippy-btn${className ? ` ${className}` : ''}`;
  b.textContent = label;
  return b;
}

/** A navy section ribbon ("Ask Clippee"). */
export function ribbon(text: string): HTMLElement {
  const rib = document.createElement('div');
  rib.className = 'mrclippy-rib';
  rib.textContent = text;
  return rib;
}

export interface TitleBar {
  readonly el: HTMLElement;
  readonly back: HTMLButtonElement;
  readonly title: HTMLElement;
  readonly settings: HTMLButtonElement;
  readonly close: HTMLButtonElement;
}

/**
 * The top ribbon, which is also the drag handle. On the notes it reads
 * "Clippee" with Settings as its only control; inside a thread it reads
 * "< Notes" and the thread's title. The X closes the panel (so do clicking
 * him and Escape); he stays on the page.
 */
export function buildTitleBar(options: ChatPanelOptions): TitleBar {
  const el = document.createElement('div');
  el.className = 'mrclippy-titlebar mrclippy-rib mrclippy-rib-first';

  const back = button('< Notes', 'mrclippy-btn-sm mrclippy-back');
  back.hidden = true;

  // The Microshaft mark, as the window icon. The hand-drawn 16 px bitmap, not
  // the vector: scaled down, the vector blurs its gutters into the tiles.
  const mark = document.createElement('img');
  mark.className = 'mrclippy-mark';
  mark.src = mark16;
  mark.srcset = `${mark16} 1x, ${mark32} 2x`;
  mark.width = 16;
  mark.height = 16;
  mark.alt = '';
  mark.draggable = false;

  const title = document.createElement('span');
  title.className = 'mrclippy-title';
  title.textContent = 'Clippee';

  const right = document.createElement('span');
  right.className = 'mrclippy-titlebtns';
  const settings = button('Settings', 'mrclippy-btn-sm mrclippy-titlebtn-settings');
  settings.title = 'Settings: API key, mute, snooze';
  settings.addEventListener('click', () => options.onSettings());
  const close = button('\u2715', 'mrclippy-btn-sm mrclippy-titlebtn-close');
  close.title = 'Close';
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', () => options.onClose());
  right.append(settings, close);

  el.append(mark, back, title, right);
  return { el, back, title, settings, close };
}

export interface Checkbox {
  readonly el: HTMLButtonElement;
  readonly on: boolean;
  /** What a click does, for the chat to use: a no-op when it is already that way. */
  set(on: boolean): void;
  setLabel(text: string): void;
}

/** A Win98 checkbox drawn as a toggle button, so it styles the same everywhere. */
export function checkbox(label: string, onChange: (on: boolean) => void): Checkbox {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'mrclippy-chk';
  el.setAttribute('aria-pressed', 'false');
  const box = document.createElement('i');
  const text = document.createElement('span');
  text.textContent = label;
  el.append(box, text);
  const isOn = (): boolean => el.getAttribute('aria-pressed') === 'true';
  const set = (on: boolean): void => {
    if (on === isOn()) return;
    el.setAttribute('aria-pressed', String(on));
    onChange(on);
  };
  el.addEventListener('click', () => set(!isOn()));
  return {
    el,
    get on() { return isOn(); },
    set,
    setLabel: (t) => (text.textContent = t),
  };
}

/**
 * An etched group box with its label on the border and, optionally, a control
 * on the right of the border (the hide-fixed checkbox). The well inside is the
 * sunken white list.
 */
export function groupBox(label: string, right?: HTMLElement): {
  box: HTMLElement;
  legend: HTMLElement;
  well: HTMLElement;
} {
  const box = document.createElement('div');
  box.className = 'mrclippy-grp';
  const legend = document.createElement('span');
  legend.className = 'mrclippy-lg';
  legend.textContent = label;
  box.appendChild(legend);
  if (right) {
    const slot = document.createElement('span');
    slot.className = 'mrclippy-grp-rt';
    slot.appendChild(right);
    box.appendChild(slot);
  }
  const well = document.createElement('div');
  well.className = 'mrclippy-well';
  box.appendChild(well);
  return { box, legend, well };
}

export function buildChips(
  onAudit: () => void,
  onAsk: (question: string, label: string) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'mrclippy-chips';

  for (const action of QUICK_ACTIONS) {
    const chip = button(action.label, 'mrclippy-btn-sm mrclippy-chip');
    chip.addEventListener('click', () => {
      if (action.id === 'structure') onAudit();
      else onAsk(action.question, action.label);
    });
    row.appendChild(chip);
  }

  return row;
}

export interface AskArea {
  readonly el: HTMLElement;
  readonly form: HTMLFormElement;
  readonly input: HTMLTextAreaElement;
  readonly send: HTMLButtonElement;
  /** His one-line answer to a request made from a list, which has no chat to put it in. */
  readonly reply: HTMLElement;
}

/**
 * "Ask Clippee": the ribbon, the chips under it, his last word on a request,
 * a sunken box and a big Ask. The same box on every screen.
 */
export function buildAskArea(chips: HTMLElement): AskArea {
  const el = document.createElement('div');
  el.className = 'mrclippy-ask-area';

  const inner = document.createElement('div');
  inner.className = 'mrclippy-ask-in';

  const form = document.createElement('form');
  form.className = 'mrclippy-composer';

  const input = document.createElement('textarea');
  input.className = 'mrclippy-input';
  input.rows = 2;
  input.placeholder = 'Ask a question, or tell me what to change…';
  input.setAttribute('aria-label', 'Ask Clippee');

  const send = button('Ask', 'mrclippy-btn-default mrclippy-send');
  send.type = 'submit';

  form.append(input, send);
  const reply = document.createElement('div');
  reply.className = 'mrclippy-ask-reply';
  reply.setAttribute('role', 'status');
  reply.setAttribute('aria-live', 'polite');
  reply.hidden = true;
  inner.append(chips, reply, form);
  el.append(ribbon('Ask Clippee'), inner);
  return { el, form, input, send, reply };
}
