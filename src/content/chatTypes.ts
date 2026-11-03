import type { ChatTurn, DocumentEdit } from '../agent/types';

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

export interface AgentReply {
  readonly text: string;
  readonly changes?: readonly AgentChange[];
  /** Edits he suggests. Shown as before/after; applied only on the user's say-so. */
  readonly proposals?: readonly DocumentEdit[];
}

export interface ChatPanelOptions {
  readonly onAsk: (question: string, history: readonly ChatTurn[]) => Promise<AgentReply>;
  /** Reverse the applied changes from one reply. Resolves to a line for the log. */
  readonly onUndo?: (changes: readonly AgentChange[]) => Promise<string>;
  /** The structure audit. Runs the local-then-cloud ladder, not a chat turn. */
  readonly onAudit: () => Promise<string>;
  /** Local findings, offered as an opening move rather than shoved at the user. */
  readonly findings: readonly PanelFinding[];
  /** Can he write into this document? Hides Fix buttons when he cannot. */
  readonly canEdit?: boolean;
  /** Apply accepted proposals. Resolves to what actually happened to each. */
  readonly onApply?: (edits: readonly DocumentEdit[]) => Promise<AgentChange[]>;
  /** Select a passage in the page so the user can see it. */
  readonly onLocate?: (passage: string) => void;
  /** Draft every fix as soon as the panel opens, so Apply is one click. */
  readonly prefetch?: boolean;
  readonly onDismissFinding: (index: number) => void;
  /** Escape. There is no close button: clicking him closes it too. */
  readonly onClose: () => void;
  /** Open Settings: API key, mute, snooze, per-site switch. */
  readonly onSettings: () => void;
  /** The document's name, for "on <title>" under the heading. */
  readonly docTitle?: string;
}

/** Where one thread stands, reported back to its line in the notes list. */
export type ThreadState =
  | { readonly kind: 'working' }
  | { readonly kind: 'ready'; readonly count: number }
  | { readonly kind: 'answered' }
  | { readonly kind: 'applied' }
  | { readonly kind: 'skipped' }
  | { readonly kind: 'failed'; readonly reason?: string };

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
  /** Set once proposals arrive: applies every one still pending. */
  applyAll?: () => Promise<AgentChange[]>;
  /** The first draft request, so Fix all can wait for it. */
  drafting?: Promise<void>;
  /** Fix threads report progress back to their row in the list. */
  readonly onStatus?: (state: ThreadState) => void;
  /** Pinned under the thread instead of scrolling with it (Undo all, Redo). */
  foot?: HTMLElement;
  /** No composer: a thread that is a result, not a conversation. */
  readonly quiet?: boolean;
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
  body = body.replace(/\s+—\s+(\d+ instances)/, ' $1');
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

/** "3 ready, 1 drafting, 1 applied, 1 failed". Empty kinds are left out. */
export function tallyLine(states: readonly (ThreadState | undefined)[]): string {
  const count = (k: ThreadState['kind']): number => states.filter((s) => s?.kind === k).length;
  const parts: [number, string][] = [
    [count('ready'), 'ready'],
    [count('working'), 'drafting'],
    [count('applied'), 'applied'],
    [count('failed'), 'failed'],
  ];
  return parts
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}`)
    .join(', ');
}
