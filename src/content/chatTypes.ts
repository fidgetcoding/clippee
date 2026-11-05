import type { PanelAction, PanelState, SnoozeLength } from '../agent/panelTools';
import type { ChatTurn, DocumentEdit } from '../agent/types';
import type { HistoryApi } from './docHistory';

/** A local finding, with the passage it is about when there is one. */
export interface PanelFinding {
  readonly text: string;
  readonly anchor?: string;
  /** The check that produced it (`hedging`, `echo`…), for the bold label. */
  readonly kind?: string;
}

export interface QuickAction {
  readonly id: string;
  readonly label: string;
  readonly question: string;
}

/** One edit as it actually went, for the receipt under his reply. */
export interface AgentChange {
  readonly find: string;
  readonly replace: string;
  readonly applied: boolean;
  /** Plain-English reason, when it did not apply. */
  readonly reason?: string;
}

export interface UndoResult {
  readonly message: string;
  readonly undone: readonly AgentChange[];
}

export interface AgentReply {
  readonly text: string;
  readonly changes?: readonly AgentChange[];
  /** Edits he suggests. Shown as before/after; applied only on the user's say-so. */
  readonly proposals?: readonly DocumentEdit[];
  /** He answered by working the panel. Run through the same paths as the buttons. */
  readonly actions?: readonly PanelAction[];
}

export interface ChatPanelOptions {
  /** `panel` is sent with typed questions only, so he can answer by working the panel. */
  readonly onAsk: (question: string, history: readonly ChatTurn[], panel?: PanelState) => Promise<AgentReply>;
  /** Reverse the applied changes from one reply. Resolves to a line for the log. */
  readonly onUndo?: (changes: readonly AgentChange[]) => Promise<string | UndoResult>;
  /** The structure audit. Runs the local-then-cloud ladder, not a chat turn. */
  readonly onAudit: () => Promise<string>;
  /** Local findings, offered as an opening move rather than shoved at the user. */
  readonly findings: readonly PanelFinding[];
  /** Can he write into this document? Hides Fix buttons when he cannot. */
  readonly canEdit?: boolean;
  /**
   * Apply accepted proposals. Resolves to what actually happened to each.
   * `origin` is what the History calls it: the fix's title, "Fix all", or the question.
   */
  readonly onApply?: (edits: readonly DocumentEdit[], origin?: string) => Promise<AgentChange[]>;
  /** Redo known receipts without losing their shared undo identity. */
  readonly onRedo?: (changes: readonly AgentChange[]) => Promise<AgentChange[]>;
  /** Select a passage in the page so the user can see it. */
  readonly onLocate?: (passage: string) => void;
  /** Draft every fix as soon as the panel opens, so Apply is one click. */
  readonly prefetch?: boolean;
  /** No API key yet: list the notes, offer Settings once, draft nothing. */
  readonly needsKey?: boolean;
  readonly onDismissFinding: (index: number) => void;
  /** Escape. There is no close button: clicking him closes it too. */
  readonly onClose: () => void;
  /** Open Settings: API key, mute, snooze, per-site switch. */
  readonly onSettings: () => void;
  /** "Snooze for an hour", asked in the chat. */
  readonly onSnooze?: (length: SnoozeLength) => Promise<unknown>;
  /** "Mute" or "unmute", asked in the chat. */
  readonly onMute?: (muted: boolean) => Promise<unknown>;
  /** The document's name, for "on <title>" under the heading. */
  readonly docTitle?: string;
  /** Fix all has finished and at least one fix landed. He celebrates. */
  readonly onFixAllLanded?: () => void;
  /** Every change he has made to this doc, kept across reloads. Absent: no History button. */
  readonly history?: HistoryApi;
  /** The History undid or redid these changes: bring their receipts in line. */
  readonly liveChanges?: (ids: readonly string[]) => readonly AgentChange[];
}

/** Where one thread stands, reported back to its line in the notes list. */
export type ThreadState =
  | { readonly kind: 'working' }
  | { readonly kind: 'ready'; readonly count: number }
  | { readonly kind: 'answered' }
  | { readonly kind: 'applied' }
  /** Applied, then taken back out with Undo. */
  | { readonly kind: 'undone' }
  | { readonly kind: 'skipped' }
  | { readonly kind: 'failed'; readonly reason?: string };

/** Undo and Redo over one set of applied changes: a receipt, or Fix all's whole screen. */
export interface ChangeControl {
  /** Every change in it is out of the document. */
  readonly undone: boolean;
  /** What Undo would take out now, or Redo would put back. */
  readonly changes: readonly AgentChange[];
  /** Resolve to whether anything changed. */
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  /** The History already took these out (or put them back): show it, touch nothing. */
  settle(undone: boolean): void;
}

/** The Fix all screen's own controls, for the chat to reach. */
export interface ResultControls extends ChangeControl {
  readonly applied: number;
  readonly hiding: boolean;
  /** What the "Hide applied" checkbox does. */
  hide(on: boolean): void;
}

/**
 * One conversation. The panel's main thread holds the list of notes and any
 * general chat; every Fix gets a thread of its own, so its back-and-forth and
 * its proposals stay together and the list stays readable.
 */
export interface Thread {
  readonly log: HTMLElement;
  readonly title: string;
  readonly history: ChatTurn[];
  busy: boolean;
  /** Set once proposals arrive: applies every one still pending. `origin` overrides the thread's for the History. */
  applyAll?: (origin?: string) => Promise<AgentChange[]>;
  /** What the History calls changes made from this thread. */
  readonly origin?: string;
  /** The first draft request, so Fix all can wait for it. */
  drafting?: Promise<void>;
  /** Fix threads report progress back to their row in the list. */
  readonly onStatus?: (state: ThreadState) => void;
  /** The last state reported through `onStatus`. */
  state?: ThreadState;
  /** Pinned under the thread instead of scrolling with it (Undo all, Redo). */
  foot?: HTMLElement;
  /** A result, not a conversation: questions asked from it open a chat of their own. */
  readonly quiet?: boolean;
  /** Every receipt's Undo/Redo, oldest first. */
  receipts?: ChangeControl[];
  /** What Skip does on every proposal still waiting. Resolves to how many it skipped. */
  skipAll?: () => number;
  /** Set on the Fix all screen. */
  results?: ResultControls;
}

/**
 * Quick-start chips.
 *
 * A blank text box asks the user to invent a question, which is where most
 * people close the thing. These are openings, not a menu — picking one drops its
 * text into the conversation and the chat continues from there, so there is
 * never a mode to back out of.
 */
export const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    id: 'tighten',
    label: 'Tighten this',
    question:
      'Pick the flabbiest paragraph in this document and tighten it in place. Keep my voice and every fact.',
  },
  {
    id: 'summarize',
    label: 'Sum it up',
    question: 'Summarise this document in three sentences.',
  },
  {
    id: 'holes',
    label: "What's missing?",
    question:
      'What is missing from this document — an unanswered question, a promise I made and never delivered, a gap in the argument? Name the single biggest one.',
  },
  {
    id: 'structure',
    label: 'Check my structure',
    // Handled locally rather than as a chat turn — it runs the signal ladder.
    question: '',
  },
  {
    id: 'critique',
    label: 'Be harsh',
    question:
      'What is the weakest part of this document and why? Be specific and quote the sentence. Do not soften it.',
  },
];

/** The instruction behind a finding's Fix button: this one thing, nothing else. */
export function fixQuestion(finding: PanelFinding): string {
  const where = finding.anchor ? ` It is about this passage: "${finding.anchor}".` : '';
  return `Fix only this one issue and change nothing else in the document: ${finding.text}${where} Use the smallest edits that fix it.`;
}

export function describeForHistory(reply: AgentReply): string {
  const proposed = reply.proposals ?? [];
  if (proposed.length > 0) {
    const list = proposed.map((e) => `- "${e.find}" -> "${e.replace}"`).join('\n');
    return `${reply.text}\n\n[Edits I proposed. The user applies or skips each one:\n${list}]`;
  }
  const applied = reply.changes?.filter((c) => c.applied) ?? [];
  if (applied.length === 0) return reply.text;
  const list = applied.map((c) => `- "${c.find}" -> "${c.replace}"`).join('\n');
  return `${reply.text}\n\n[Edits I made to the document:\n${list}]`;
}

/** "Copy of Essay - Google Docs" -> "Copy of Essay". Undefined when there is none. */
export function docTitleFrom(title: string | undefined): string | undefined {
  const trimmed = (title ?? '').replace(/\s+-\s+Google Docs\s*$/, '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** The short bold label each check's notes lead with. */
const KIND_LABELS: Readonly<Record<string, string>> = {
  readability: 'Readability',
  echo: 'Echo',
  wordiness: 'Wordy',
  hedging: 'Hedge',
  'paragraph-balance': 'Long paragraph',
  weasel: 'Intensifier',
  metadiscourse: 'Throat-clearing',
  'passive-voice': 'Passive',
  'there-is': 'Buried subject',
  'repeated-opener': 'Repeated opener',
};

/**
 * Split a note into its bold label and the rest. Style notes already lead with
 * their label ("Hedge — the sentence is…"), so that is lifted out rather than
 * shown twice.
 */
export function noteLabel(finding: PanelFinding): { label?: string; body: string } {
  let body = finding.text;
  let label = finding.kind ? KIND_LABELS[finding.kind] : undefined;
  const lead = /^([A-Z][\w-]*(?: [\w-]+)?)\s+[—:]\s+/.exec(body);
  if (lead && (!label || lead[1] === label)) {
    label = lead[1];
    body = body.slice(lead[0].length);
  }
  body = body
    .replace(/\s+—\s+(\d+ instances)/, ' $1')
    .replace(/\s+—\s+(and \d+ more)/, ', $1');
  // "Hedge — the sentence is…" loses its label; the rest starts a sentence.
  if (label && body) body = body.charAt(0).toUpperCase() + body.slice(1);
  return label ? { label, body } : { body };
}

/**
 * A fix thread's title: 'Hedge: "I believe"' when the note quotes its passage,
 * otherwise the label and the note, so the ribbon stays short.
 */
export function fixTitle(finding: PanelFinding): string {
  const { label, body } = noteLabel(finding);
  const { anchor } = finding;
  if (label && anchor && body.includes(`"${anchor}"`)) return `${label}: "${anchor}"`;
  return label ? `${label}. ${body}` : body;
}

/**
 * Where the fixes stand, in plain words: "Writing fixes: 3 of 7 done" while any
 * are waiting or being written, then "All 7 fixes are written", then "2 of 7
 * applied". `undefined` is a fix still waiting its turn. Empty when no fix has
 * been asked for.
 */
export function tallyLine(states: readonly (ThreadState | undefined)[]): string {
  if (states.every((s) => s === undefined)) return '';
  const total = states.length;
  const count = (k: ThreadState['kind']): number => states.filter((s) => s?.kind === k).length;
  const pending = states.filter((s) => s === undefined || s.kind === 'working').length;
  const failed = count('failed');
  const applied = count('applied');
  const head =
    pending > 0
      ? `Writing fixes: ${total - pending} of ${total} done`
      : applied > 0
        ? `${applied} of ${total} applied`
        : failed > 0
          ? `${total - failed} of ${total} fixes written`
          : total === 1
            ? 'The fix is written'
            : `All ${total} fixes are written`;
  return failed > 0 ? `${head}, ${failed} failed` : head;
}
