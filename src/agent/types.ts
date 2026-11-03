/** Messages exchanged between the content script and the background worker. */

export interface AskRequest {
  readonly type: 'mrclippy:ask';
  /** What the user typed. */
  readonly question: string;
  /** The document, as best we can read it. */
  readonly document: string;
  /** Prior turns, oldest first. Excludes the current question. */
  readonly history: readonly ChatTurn[];
  /** Findings the local checks already produced, so he does not repeat them. */
  readonly findings: readonly string[];
  /** Passages retrieved from the user's other documents. */
  readonly related?: readonly RelatedContext[];
  /** True when the page can take edits, so he is given the edit tool. */
  readonly canEdit?: boolean;
}

/** One change he wants made: swap `find` (quoted from the document) for `replace`. */
export interface DocumentEdit {
  readonly find: string;
  readonly replace: string;
}

export interface RelatedContext {
  readonly title: string;
  readonly path: readonly string[];
  readonly text: string;
  readonly reasons: readonly string[];
}

export interface ChatTurn {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export interface AuditRequest {
  readonly type: 'mrclippy:audit';
  readonly document: string;
}

export interface AuditFinding {
  readonly about: string;
  readonly problem: string;
  readonly evidence?: string;
  readonly confidence: 'high' | 'medium' | 'low';
}

export type AuditResponse =
  | { readonly ok: true; readonly findings: readonly AuditFinding[] }
  | { readonly ok: false; readonly error: string; readonly needsKey?: boolean };

export type AskResponse =
  | { readonly ok: true; readonly text: string; readonly edits?: readonly DocumentEdit[] }
  | { readonly ok: false; readonly error: string; readonly needsKey?: boolean };

export const MAX_DOCUMENT_CHARS = 60_000;
export const MAX_HISTORY_TURNS = 12;
/** Past this, one request is a rewrite of the document, not an edit to it. */
export const MAX_EDITS = 25;
