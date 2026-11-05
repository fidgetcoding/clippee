/**
 * The panel as a tool. A question typed into the chat carries a snapshot of
 * what the user is looking at, and he can answer it by operating the panel
 * (hide applied, Fix all, apply the echo fix, snooze) instead of in words.
 *
 * The tool and its prompt are sent with every ask, drafts included, so the
 * tools-then-system prefix never changes and the cached document keeps
 * hitting. Only the snapshot varies, and it rides in the last user turn.
 */

export type PanelScreen = 'notes' | 'fix' | 'fix-all' | 'question' | 'history';

export interface PanelNoteState {
  /** 1-based and stable for the panel's life: ignoring a note does not renumber the rest. */
  readonly number: number;
  /** The bold label ("Echo"), or empty. */
  readonly label: string;
  readonly text: string;
  /** Plain words: "fix ready: 2 changes", "applied", "failed: no reply". */
  readonly status: string;
}

export interface PanelQuestionState {
  readonly number: number;
  readonly title: string;
  readonly status: string;
}

export interface PanelState {
  readonly screen: PanelScreen;
  readonly title: string;
  /** The note whose fix thread is open, when it is one. */
  readonly note?: number;
  readonly notes: readonly PanelNoteState[];
  readonly questions: readonly PanelQuestionState[];
  /** The checkbox on the list in view: Hide fixed on the notes, Hide applied on Fix all. */
  readonly hideDone: boolean;
  readonly fixAll: 'unavailable' | 'ready' | 'running' | 'done';
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export const PANEL_ACTIONS = [
  'hide_done', 'show_done', 'fix_all', 'show_results', 'apply', 'skip', 'open_note',
  'ignore_note', 'retry_note', 'undo', 'undo_all', 'redo', 'open_question', 'back',
  'settings', 'snooze', 'mute', 'unmute', 'check_structure', 'close', 'show_history', 'undo_last',
] as const;
export type PanelActionName = (typeof PANEL_ACTIONS)[number];

export const SNOOZE_LENGTHS = ['15m', '1h', 'today'] as const;
export type SnoozeLength = (typeof SNOOZE_LENGTHS)[number];

export interface PanelAction {
  readonly action: PanelActionName;
  /** A note's number from the snapshot. */
  readonly note?: number;
  /** A question's number from the snapshot. */
  readonly question?: number;
  readonly duration?: SnoozeLength;
}

/** More than this in one reply is not a command, it is a script. */
export const MAX_ACTIONS = 8;

export const PANEL_PROMPT = `You live in a panel the user clicks around in, and you can work it for them with the use_panel tool.

When the user's message comes with a <panel> block, that block is what they are looking at right now: the screen, every note with its number and status, their questions, and the state of the controls. Without a <panel> block, never call use_panel.

If they ask for something the panel can do, call use_panel and write nothing else: the panel tells them what happened. Read typos and loose wording generously. "hid applied" means hide applied; "fix the readability one" means apply the fix for the Readability note; "nvm go back" means back.

Pick notes by number from the <panel> block, matching on the label, the quoted passage or what the note says. If a request could mean two notes, ask which one instead of guessing.

Applying a listed note's fix is use_panel apply with that note's number, not edit_document: its fix is already drafted. Use edit_document only for a change the user describes that no listed note covers.

If nothing in the panel matches what they asked, answer normally.`;

export const PANEL_TOOL = {
  name: 'use_panel',
  description:
    'Work the Clippee panel for the user, exactly as if they clicked it. Actions run in order. Only use it when the message has a <panel> block.',
  input_schema: {
    type: 'object' as const,
    properties: {
      actions: {
        type: 'array',
        description: 'What to do, in order.',
        items: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: [...PANEL_ACTIONS],
              description: [
                'hide_done / show_done: tick or untick "Hide applied" (Fix all screen) or "Hide fixed" (notes).',
                'fix_all: apply every drafted fix at once. show_results: open the Fix all result screen again.',
                'apply: apply a note\'s drafted fix (note), or the proposals in the open thread (no note).',
                'skip: skip a note\'s proposals (note), or the open thread\'s.',
                'open_note: open a note\'s fix thread. ignore_note: never show that kind of note again.',
                'retry_note: write a failed fix again.',
                'undo: take back one note\'s applied fix (note), or the open thread\'s. undo_all: take back every change.',
                'undo_last: take back the most recent change he made to this doc, wherever it came from.',
                'redo: put back what was undone. show_history: open the History of every change made to this doc.',
                'open_question: reopen one of the user\'s questions (question). back: return to the notes.',
                'settings: open Settings (API key, mute, snooze). snooze: no suggestions for a while (duration).',
                'mute / unmute: stop or resume pop-up suggestions. check_structure: run the structure check.',
                'close: put the panel away.',
              ].join('\n'),
            },
            note: { type: 'integer', description: 'The note number from the <panel> block.' },
            question: { type: 'integer', description: 'The question number from the <panel> block.' },
            duration: { type: 'string', enum: [...SNOOZE_LENGTHS], description: 'How long to snooze.' },
          },
          required: ['action'],
        },
      },
    },
    required: ['actions'],
  },
};

const isIndex = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1;

/** Model output: anything malformed is dropped, not repaired. */
export function parsePanelCall(input: unknown): PanelAction[] {
  const raw = (input as { actions?: unknown } | null)?.actions;
  if (!Array.isArray(raw)) return [];
  const actions: PanelAction[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (!(PANEL_ACTIONS as readonly unknown[]).includes(e.action)) continue;
    actions.push({
      action: e.action as PanelActionName,
      ...(isIndex(e.note) ? { note: e.note } : {}),
      ...(isIndex(e.question) ? { question: e.question } : {}),
      ...((SNOOZE_LENGTHS as readonly unknown[]).includes(e.duration) ? { duration: e.duration as SnoozeLength } : {}),
    });
  }
  return actions.slice(0, MAX_ACTIONS);
}

const SCREENS: readonly PanelScreen[] = ['notes', 'fix', 'fix-all', 'question', 'history'];
const MAX_ROWS = 200;
const str = (v: unknown): v is string => typeof v === 'string';

/** The snapshot crosses a message boundary, so the worker checks its shape. */
export function isPanelState(value: unknown): value is PanelState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const rows = (a: unknown, name: 'text' | 'title'): boolean =>
    Array.isArray(a) && a.length <= MAX_ROWS && a.every((r: unknown) => {
      if (!r || typeof r !== 'object') return false;
      const row = r as Record<string, unknown>;
      return isIndex(row.number) && str(row[name]) && str(row.status) && (name === 'title' || str(row.label));
    });
  return (SCREENS as readonly unknown[]).includes(v.screen) && str(v.title) &&
    (v.note === undefined || isIndex(v.note)) && rows(v.notes, 'text') && rows(v.questions, 'title') &&
    typeof v.hideDone === 'boolean' && typeof v.canUndo === 'boolean' && typeof v.canRedo === 'boolean' &&
    ['unavailable', 'ready', 'running', 'done'].includes(v.fixAll as string);
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const SCREEN_NAMES: Readonly<Record<PanelScreen, string>> = {
  notes: 'the notes list',
  fix: 'a fix thread',
  'fix-all': 'the Fix all result screen',
  question: 'one of their questions',
  history: 'the History of every change made to this doc',
};

/** The snapshot as the model reads it: short lines, numbers it can quote back. */
export function buildPanelBlock(state: PanelState): string {
  const hide = state.screen === 'fix-all' ? 'Hide applied' : 'Hide fixed';
  const lines = [
    `Screen: ${SCREEN_NAMES[state.screen]}, titled "${clip(state.title, 120)}".` +
      (state.note !== undefined ? ` It is the fix for note ${state.note}.` : ''),
    `${hide}: ${state.hideDone ? 'on' : 'off'}. Fix all: ${state.fixAll}. ` +
      `Undo: ${state.canUndo ? 'available' : 'nothing to undo'}. Redo: ${state.canRedo ? 'available' : 'nothing to redo'}.`,
  ];
  lines.push(state.notes.length > 0 ? 'Notes:' : 'Notes: none.');
  for (const n of state.notes) {
    lines.push(`${n.number}. ${n.label ? `${n.label}. ` : ''}${clip(n.text, 240)} [${n.status}]`);
  }
  if (state.questions.length > 0) lines.push('Their questions:');
  for (const q of state.questions) lines.push(`${q.number}. "${clip(q.title, 120)}" [${q.status}]`);
  return `<panel>\n${lines.join('\n')}\n</panel>`;
}
