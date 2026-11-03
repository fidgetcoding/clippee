/**
 * Interruption model.
 *
 * Every constant and rule in this module traces to the interruption literature,
 * not to intuition. The headline findings this encodes:
 *
 *  - Interrupting mid-task rather than at a perceptual boundary costs 3-27% more
 *    completion time, roughly twice the errors, and up to 106% more annoyance.
 *    Deferring by seconds recovers most of that.
 *  - Completing a sentence is NOT a breakpoint. Observers do not perceive it as
 *    one, because sentence-level editing is a blur of typing, erasing, selecting
 *    and scrolling. See `Breakpoint`.
 *  - An assistant firing on 2-second pauses saved writers ~24s of a 237s essay
 *    while costing them 109-112s of reading suggestions instead of writing — and
 *    measurably steered what they wrote without them noticing. Hence
 *    `MIN_SILENCE_MS`.
 *  - A patient assistant was preferred by 90% of participants; an eager variant
 *    of the same assistant by 47%. Hence `MIN_RENDER_GAP_MS`.
 */

/**
 * Perceptual seams in a writing session, coarsest last.
 *
 * Deliberately absent: sentence completion. It is the intuitive trigger and the
 * wrong one.
 */
export const Breakpoint = {
  /** Completed selection, paste, find/replace, or formatting command. */
  Fine: 'fine',
  /** Moved to a different section, saved, or switched documents. */
  Medium: 'medium',
  /** Returned to the document from another app or tab. */
  Coarse: 'coarse',
} as const;

export type Breakpoint = (typeof Breakpoint)[keyof typeof Breakpoint];

/** What a suggestion is about, which selects *which* seam it may fire at. */
export const Relevance = {
  /** About the sentence or paragraph being written right now. */
  Sentence: 'sentence',
  /** About the document as a whole — structure, an earlier inconsistency. */
  Document: 'document',
  /** About nothing the writer is doing. Tips, feature discovery, upsells. */
  General: 'general',
} as const;

export type Relevance = (typeof Relevance)[keyof typeof Relevance];

/**
 * Which seams each relevance class may fire at.
 *
 * The counter-intuitive entry is `Sentence`: it may NOT fire at a coarse
 * breakpoint. Writers who received relevant content while deliberately leaving a
 * task disliked it specifically because it pulled them back from a switch they
 * had chosen to make.
 *
 * `General` is allowed only at coarse, which in practice means it should not
 * ship at all — general-interest notifications produced significantly more
 * frustration than relevant ones in field conditions.
 */
export const RELEVANCE_POLICY: Readonly<Record<Relevance, readonly Breakpoint[]>> = {
  [Relevance.Sentence]: [Breakpoint.Fine, Breakpoint.Medium],
  [Relevance.Document]: [Breakpoint.Medium],
  [Relevance.General]: [Breakpoint.Coarse],
};

/** Default time-to-live per relevance class. Expiry is silent death. */
export const DEFAULT_TTL_MS: Readonly<Record<Relevance, number>> = {
  [Relevance.Sentence]: 90_000,
  [Relevance.Document]: 300_000,
  [Relevance.General]: 300_000,
};

/** Minimum quiet period before anything may render. */
export const MIN_SILENCE_MS = 15_000;

/** Hard cap between rendered suggestions. */
export const MIN_RENDER_GAP_MS = 600_000;

/** Dismissals of one kind before that kind stops being offered. */
export const DISMISS_STRIKES = 3;

export interface SuggestionRequest {
  /**
   * The kind of thing this is — "passive-voice", "thesis-drift", "contradiction".
   * Dismissal memory is keyed on this, not on the individual suggestion, so
   * rejecting one passive-voice note teaches Mr. Clippy about passive-voice notes.
   */
  readonly kind: string;
  readonly relevance: Relevance;
  /** 0-1. Low-confidence items lose to high-confidence ones at the same seam. */
  readonly confidence: number;
  /** One line, shown in the balloon. */
  readonly text: string;
  /**
   * The exact passage this is about, copied from the document. Lets the panel
   * point at it (select it in the page) and ask for a fix scoped to it.
   * Absent for document-wide notes like reading level.
   */
  readonly anchor?: string;
  /** Collapses duplicates already queued. Defaults to `kind`. */
  readonly dedupeKey?: string;
  /** Overrides the class default. */
  readonly ttlMs?: number;
  /** Arbitrary payload for the renderer — a diff, a range, a citation. */
  readonly payload?: unknown;
}

export interface QueuedSuggestion extends SuggestionRequest {
  readonly id: string;
  readonly queuedAt: number;
  readonly expiresAt: number;
}

/** Why a queued suggestion left the queue without being shown. */
export const DropReason = {
  Expired: 'expired',
  Duplicate: 'duplicate',
  Suppressed: 'suppressed',
  Cleared: 'cleared',
} as const;

export type DropReason = (typeof DropReason)[keyof typeof DropReason];
