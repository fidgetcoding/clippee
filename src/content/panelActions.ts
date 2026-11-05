import type { PanelAction, PanelState, SnoozeLength } from '../agent/panelTools';
import type { FixAllBar } from './changeCards';
import type { HistoryScreen } from './historyView';
import {
  noteLabel,
  type AgentChange,
  type ChangeControl,
  type ChatPanelOptions,
  type PanelFinding,
  type Thread,
  type ThreadState,
} from './chatTypes';
import type { NoteRow, NotesView } from './notesView';

/** One note's controls: what its buttons do, callable from the chat. */
export interface NoteControl {
  readonly index: number;
  readonly finding: PanelFinding;
  readonly row: NoteRow;
  readonly canFix: boolean;
  readonly dismissed: boolean;
  /** The fix thread, once there is one. */
  thread(): Thread | undefined;
  /** Review: the fix thread, or the passage when there is no fix. */
  open(): void;
  /** Apply: waits for the draft, then applies what it proposes. */
  apply(): Promise<AgentChange[]>;
  retry(): void;
}

export interface QuestionEntry {
  readonly thread: Thread;
  readonly title: string;
  readonly state: ThreadState | undefined;
  readonly removed: boolean;
}

/** What the chat may reach in the panel. Everything here is also a button. */
export interface PanelHost {
  readonly options: ChatPanelOptions;
  readonly notes: NotesView;
  readonly main: Thread;
  active(): Thread;
  allNotes(): readonly NoteControl[];
  noteOf(thread: Thread): NoteControl | undefined;
  questions(): readonly QuestionEntry[];
  fixAll(): FixAllBar | undefined;
  /** The Fix all result screen, once Fix all has run. */
  results(): Thread | undefined;
  threads(): readonly Thread[];
  /** The History screen's thread, once opened. */
  history(): Thread | undefined;
  historyScreen(): HistoryScreen | undefined;
  /** Open the History. Undefined where there is none. */
  showHistory(): HistoryScreen | undefined;
  show(thread: Thread): void;
  audit(): void;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function noteStatus(host: PanelHost, c: NoteControl): string {
  if (!c.canFix) {
    return host.options.needsKey ? 'no fix until an API key is in Settings' : "no fix, I can't change this one";
  }
  const s = c.row.state;
  switch (s?.kind) {
    case undefined: return host.options.prefetch ? 'waiting to be written' : 'not started';
    case 'working': return 'writing a fix';
    case 'ready': return `fix ready: ${plural(s.count, 'change')}`;
    case 'applied': return 'applied';
    case 'failed': return s.reason ? `failed: ${s.reason}` : 'failed';
    case 'answered': return 'no change';
    case 'undone': return 'applied, then undone';
    case 'skipped': return 'skipped';
  }
}

const QUESTION_STATUS: Readonly<Record<ThreadState['kind'], string>> = {
  working: 'working', ready: 'changes to review', answered: 'answered', applied: 'applied',
  undone: 'undone', skipped: 'skipped', failed: 'failed',
};

/** Every receipt, plus Fix all's screen when it has an Undo all. */
function controlsOf(host: PanelHost): ChangeControl[] {
  const results = host.results()?.results;
  const screen = results && results.applied > 0 && host.options.onUndo ? [results] : [];
  return [...host.threads().flatMap((t) => t.receipts ?? []), ...screen];
}

/** The panel as he is shown it with a typed question. */
export function describePanel(host: PanelHost, here: Thread = host.active()): PanelState {
  const fix = host.noteOf(here);
  const results = here.results;
  const bar = host.fixAll();
  const controls = controlsOf(host);
  return {
    screen: here === host.main ? 'notes' : here === host.history() ? 'history' : results ? 'fix-all' : fix ? 'fix' : 'question',
    title: here.title,
    ...(fix ? { note: fix.index + 1 } : {}),
    notes: host.allNotes().filter((c) => !c.dismissed).map((c) => {
      const { label, body } = noteLabel(c.finding);
      return { number: c.index + 1, label: label ?? '', text: body, status: noteStatus(host, c) };
    }),
    questions: host.questions().flatMap((q, i) => q.removed ? [] : [{
      number: i + 1,
      title: q.title,
      status: q.state ? QUESTION_STATUS[q.state.kind] : 'not asked yet',
    }]),
    hideDone: results ? results.hiding : host.notes.hidingFixed,
    fixAll: bar?.state === 'running' ? 'running' : host.results() ? 'done' : bar?.state ?? 'unavailable',
    canUndo: controls.some((c) => !c.undone),
    canRedo: controls.some((c) => c.undone),
  };
}

/** "the Echo fix" / "the fix for note 3". */
function fixName(c: NoteControl): string {
  const { label } = noteLabel(c.finding);
  return label ? `the ${label} fix` : `the fix for note ${c.index + 1}`;
}

async function applyNote(c: NoteControl): Promise<string> {
  if (!c.canFix) return `I can't fix note ${c.index + 1} here.`;
  const changes = await c.apply();
  const name = fixName(c);
  if (changes.length === 0) {
    const kind = c.row.state?.kind;
    if (kind === 'failed') return `I couldn't write ${name}. Say "retry" and I'll try again.`;
    if (kind === 'applied') return `${cap(name)} is already in.`;
    if (kind === 'answered') return `I didn't find anything to change for note ${c.index + 1}.`;
    return `There's nothing left to apply for ${name}.`;
  }
  const landed = changes.filter((x) => x.applied).length;
  if (landed === changes.length) return `Applied ${name}.`;
  if (landed === 0) return `Couldn't apply ${name}. ${changes[0]?.reason ?? 'The text has changed since.'}`;
  return `Applied ${landed} of ${changes.length} changes for ${name}.`;
}

/** Run each in turn, newest first for undo, and say whether any of them did something. */
async function each(controls: readonly ChangeControl[], step: (c: ChangeControl) => Promise<boolean>): Promise<boolean> {
  let any = false;
  for (const c of controls) any = (await step(c)) || any;
  return any;
}

const SNOOZE_WORDS: Readonly<Record<SnoozeLength, string>> = {
  '15m': 'for 15 minutes', '1h': 'for an hour', today: 'for the rest of today',
};

async function runAction(host: PanelHost, a: PanelAction, here: Thread): Promise<string | undefined> {
  const note = a.note === undefined ? undefined : host.allNotes()[a.note - 1];
  if (a.note !== undefined && (!note || note.dismissed)) return `I can't find note ${a.note}.`;
  const { options } = host;
  // On the History screen, undo and redo mean its entries.
  const onHistory = here === host.history() ? host.historyScreen() : undefined;
  if (onHistory && !note) {
    if (a.action === 'undo' || a.action === 'undo_last') return onHistory.undoLast();
    if (a.action === 'undo_all') return onHistory.undoAll();
    if (a.action === 'redo') return onHistory.redoAll();
  }

  switch (a.action) {
    case 'hide_done':
    case 'show_done': {
      const on = a.action === 'hide_done';
      if (here.results) {
        here.results.hide(on);
        if (!on) return 'Showing the applied changes again.';
        return here.results.applied === 0
          ? "Nothing was applied, so there's nothing to hide."
          : `Hid ${plural(here.results.applied, 'applied change')}.`;
      }
      // The checkbox lives on the notes, so that's where its effect shows.
      if (here !== host.main) host.show(host.main);
      const fixed = host.notes.setHideFixed(on);
      if (fixed === undefined) return "There's no list to hide anything from.";
      if (!on) return 'Showing the fixed items again.';
      return fixed === 0 ? "Nothing's fixed yet. Fixed items will hide as they land." : `Hid ${plural(fixed, 'fixed item')}.`;
    }
    case 'fix_all': {
      const bar = host.fixAll();
      const results = host.results();
      if (bar?.state === 'running') return "Fix all's already running.";
      if (bar?.state !== 'ready') {
        if (results) {
          host.show(results);
          return "Here's what Fix all changed.";
        }
        const fixable = host.allNotes().filter((c) => c.canFix && !c.dismissed);
        if (fixable.length === 1) return applyNote(fixable[0]!);
        return options.needsKey
          ? 'I need your Claude API key before I can fix anything. Say "open settings" to add it.'
          : "There's nothing for Fix all to do.";
      }
      const changes = await bar.run();
      if (changes.length === 0) return 'Nothing left to apply.';
      return `Applied ${changes.filter((c) => c.applied).length} of ${changes.length}. Undo all is at the bottom.`;
    }
    case 'show_results': {
      const results = host.results();
      if (!results) return "Fix all hasn't run yet.";
      host.show(results);
      return "Here's what Fix all changed.";
    }
    case 'apply': {
      const target = note ?? host.noteOf(here);
      if (target) return applyNote(target);
      if (!here.applyAll) {
        return here === host.main ? 'Which note? Say it by name, like "apply the echo fix".' : "There's nothing here to apply.";
      }
      const changes = await here.applyAll();
      if (changes.length === 0) return "There's nothing left to apply here.";
      return `Applied ${changes.filter((c) => c.applied).length} of ${plural(changes.length, 'change')}.`;
    }
    case 'skip': {
      const thread = note ? note.thread() : here;
      const skipped = thread?.skipAll?.() ?? 0;
      return skipped === 0 ? "There's nothing waiting to skip." : `Skipped ${plural(skipped, 'change')}.`;
    }
    case 'open_note': {
      if (!note) return 'Which note?';
      note.open();
      return note.canFix ? `Opened ${fixName(note)}.` : "I've selected that passage in your doc.";
    }
    case 'ignore_note': {
      if (!note) return 'Which note?';
      const { label } = noteLabel(note.finding);
      if (host.active() === note.thread()) host.show(host.main);
      note.row.ignore();
      return `Ignored. I won't show ${label ? `${label} notes` : 'that kind of note'} again.`;
    }
    case 'retry_note': {
      const target = note ?? host.noteOf(here);
      if (!target) return 'Which note?';
      if (target.row.state?.kind !== 'failed') return `${cap(fixName(target))} didn't fail, so there's nothing to retry.`;
      target.retry();
      return `Writing ${fixName(target)} again.`;
    }
    case 'undo': {
      const pool = note ? note.thread()?.receipts ?? [] : here.results ? [here.results] : here.receipts ?? [];
      const live = pool.filter((c) => !c.undone).reverse();
      if (live.length === 0) {
        return here === host.main && !note
          ? 'Which one? Name the note, like "undo the echo fix", or say "undo all".'
          : "There's nothing to undo there.";
      }
      return (await each(live, (c) => c.undo())) ? (note ? `Took ${fixName(note)} back out.` : 'Took it back out.') : "Couldn't undo that.";
    }
    case 'undo_all': {
      const results = host.results()?.results;
      if (results && !results.undone && results.applied > 0) {
        return (await results.undo()) ? `Took all ${plural(results.applied, 'change')} back out.` : "Couldn't undo that.";
      }
      const live = host.threads().flatMap((t) => t.receipts ?? []).filter((c) => !c.undone).reverse();
      if (live.length > 0) return (await each(live, (c) => c.undo())) ? 'Took every change back out.' : "Couldn't undo that.";
      // Nothing from this visit: everything the History still has in.
      const history = options.history ? host.showHistory() : undefined;
      return history ? history.undoAll() : "There's nothing to undo.";
    }
    case 'undo_last': {
      const history = options.history ? host.showHistory() : undefined;
      return history ? history.undoLast() : "There's nothing to undo.";
    }
    case 'show_history':
      if (!host.showHistory()) return "There's no History here.";
      return "Here's every change I've made to this doc.";
    case 'redo': {
      const fallback = host.results()?.results;
      const pool = note ? note.thread()?.receipts ?? []
        : here.results ? [here.results]
          : here.receipts?.some((c) => c.undone) ? here.receipts : fallback ? [fallback] : [];
      const undone = pool.filter((c) => c.undone);
      if (undone.length === 0) return "There's nothing to redo.";
      return (await each(undone, (c) => c.redo())) ? (note ? `Put ${fixName(note)} back in.` : 'Put it back in.') : "Couldn't put it back.";
    }
    case 'open_question': {
      const q = a.question === undefined ? undefined : host.questions()[a.question - 1];
      if (!q || q.removed) return "I can't find that question.";
      host.show(q.thread);
      return `Opened "${q.title}".`;
    }
    case 'back':
      host.show(host.main);
      return 'Back to your notes.';
    case 'settings':
      options.onSettings();
      return 'Opened Settings.';
    case 'snooze': {
      const length = a.duration ?? '1h';
      if (!options.onSnooze) return 'Snooze is in Settings.';
      await options.onSnooze(length);
      return `Snoozed ${SNOOZE_WORDS[length]}. I won't pop up till then, but you can still click me.`;
    }
    case 'mute':
    case 'unmute': {
      const muted = a.action === 'mute';
      if (!options.onMute) return 'Mute is in Settings.';
      await options.onMute(muted);
      return muted ? "Muted. I won't pop up with suggestions. Click me any time." : "Unmuted. I'll pop up with suggestions again.";
    }
    case 'check_structure':
      host.audit();
      return undefined;
    case 'close':
      options.onClose();
      return undefined;
  }
}

/**
 * Work the panel. `here` is the screen the request came from; once an action
 * moves the panel somewhere else, the rest follow it there. Resolves to what
 * he says about it, one line per action.
 */
export async function runActions(host: PanelHost, actions: readonly PanelAction[], here: Thread): Promise<string[]> {
  const lines: string[] = [];
  for (const action of actions) {
    const before = host.active();
    try {
      const line = await runAction(host, action, here);
      if (line) lines.push(line);
    } catch (error: unknown) {
      lines.push(`Couldn't do that. ${error instanceof Error ? error.message : ''}`.trim());
    }
    if (action.action === 'close') break;
    if (host.active() !== before) here = host.active();
  }
  return lines;
}
