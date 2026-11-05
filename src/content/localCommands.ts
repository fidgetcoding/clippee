import type { PanelAction } from '../agent/panelTools';

/**
 * Plain commands that need no model: typed into the chat, they run at once,
 * offline, for free. Anything that names a note ("apply the echo fix") or
 * reads loosely goes to him instead, so this list stays exact on purpose.
 */
const COMMANDS: readonly (readonly [PanelAction, ...string[]])[] = [
  [{ action: 'hide_done' }, 'hide applied', 'hide fixed', 'hide done', 'hide applied changes', 'hide fixed items', 'hide fixed notes'],
  [{ action: 'show_done' }, 'show applied', 'show fixed', 'unhide applied', 'unhide fixed', 'show applied changes', 'show fixed items'],
  [{ action: 'fix_all' }, 'fix all', 'fix everything', 'fix them all'],
  [{ action: 'show_results' }, 'show changes', 'show results'],
  [{ action: 'undo' }, 'undo', 'undo that', 'undo it'],
  [{ action: 'undo_all' }, 'undo all', 'undo everything'],
  [{ action: 'redo' }, 'redo', 'redo that', 'redo it', 'redo all'],
  [{ action: 'back' }, 'back', 'go back', 'notes', 'back to notes', 'back to the notes', 'go back to notes',
    'go back to the notes', 'show notes', 'show my notes'],
  [{ action: 'settings' }, 'settings', 'open settings', 'show settings'],
  [{ action: 'mute' }, 'mute', 'mute suggestions'],
  [{ action: 'unmute' }, 'unmute', 'unmute suggestions'],
  [{ action: 'snooze', duration: '15m' }, 'snooze 15m', 'snooze 15 minutes', 'snooze for 15 minutes'],
  [{ action: 'snooze', duration: '1h' }, 'snooze', 'snooze 1h', 'snooze 1 hour', 'snooze an hour', 'snooze for an hour', 'snooze for 1 hour'],
  [{ action: 'snooze', duration: 'today' }, 'snooze today', 'snooze for today', 'snooze for the rest of today'],
  [{ action: 'check_structure' }, 'check my structure', 'check structure', 'check the structure'],
  [{ action: 'close' }, 'close', 'close panel', 'close the panel'],
];

const PHRASES = new Map<string, PanelAction>(
  COMMANDS.flatMap(([action, ...phrases]) => phrases.map((p) => [p, action] as const)),
);

/** "Hide applied, please!" -> "hide applied". */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[.!?,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:please|pls|ok|okay|now) /, '')
    .replace(/ (?:please|pls|now|thanks)$/, '');
}

/** One insertion, deletion, substitution or swap of neighbours apart, at most. */
function oneEditApart(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/** Below this, one typo can turn one command into another ("undo" and "redo"). */
const MIN_FUZZY = 7;

/**
 * The command a message is, or undefined. Exact after tidying, or one typo
 * away from exactly one command when long enough that a typo can't swap
 * one for another: "hid applied" is "hide applied".
 */
export function matchCommand(text: string): PanelAction | undefined {
  const said = normalize(text);
  const exact = PHRASES.get(said);
  if (exact || said.length < MIN_FUZZY) return exact;
  const near = new Set<PanelAction>();
  for (const [phrase, action] of PHRASES) {
    if (phrase.length > MIN_FUZZY && oneEditApart(said, phrase)) near.add(action);
  }
  return near.size === 1 ? [...near][0] : undefined;
}
