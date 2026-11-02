import {
  DEFAULT_TTL_MS,
  DISMISS_STRIKES,
  DropReason,
  RELEVANCE_POLICY,
  type Breakpoint,
  type QueuedSuggestion,
  type SuggestionRequest,
} from './types';

export interface SuggestionQueueOptions {
  /** Injectable clock so TTL behaviour is testable without waiting. */
  readonly now?: () => number;
  /** Persisted dismissal counts, keyed by suggestion kind. */
  readonly dismissals?: Readonly<Record<string, number>>;
  readonly onDrop?: (suggestion: QueuedSuggestion, reason: DropReason) => void;
}

/**
 * Holds candidate suggestions until a breakpoint makes one of them showable.
 *
 * Nothing here renders. `drain()` returns at most one suggestion and the caller
 * decides whether to show it — the rate limiter lives in the renderer, because
 * "is there something to say" and "am I allowed to say it" are different
 * questions and conflating them makes both untestable.
 */
export class SuggestionQueue {
  private readonly items: QueuedSuggestion[] = [];
  private readonly dismissals = new Map<string, number>();
  private readonly now: () => number;
  private readonly onDrop: ((s: QueuedSuggestion, r: DropReason) => void) | undefined;
  private seq = 0;

  constructor(options: SuggestionQueueOptions = {}) {
    this.now = options.now ?? Date.now;
    this.onDrop = options.onDrop;
    for (const [kind, count] of Object.entries(options.dismissals ?? {})) {
      this.dismissals.set(kind, count);
    }
  }

  /**
   * Live suggestion count. Expiry is lazy, so this sweeps first — otherwise a
   * caller can be told there is something to say when everything queued is dead.
   */
  get size(): number {
    this.expire();
    return this.items.length;
  }

  /** Snapshot of live suggestions, expired ones removed. */
  peek(): readonly QueuedSuggestion[] {
    this.expire();
    return [...this.items];
  }

  /**
   * Queue a candidate. Returns the queued item, or undefined if it was rejected
   * as a duplicate or because its kind has been dismissed too often.
   */
  add(request: SuggestionRequest): QueuedSuggestion | undefined {
    this.expire();

    const now = this.now();
    const ttl = request.ttlMs ?? DEFAULT_TTL_MS[request.relevance];
    const suggestion: QueuedSuggestion = {
      ...request,
      id: `${request.kind}-${++this.seq}`,
      queuedAt: now,
      expiresAt: now + ttl,
    };

    if (this.isSuppressed(request.kind)) {
      this.onDrop?.(suggestion, DropReason.Suppressed);
      return undefined;
    }

    const key = request.dedupeKey ?? request.kind;
    const existing = this.items.find((i) => (i.dedupeKey ?? i.kind) === key);
    if (existing) {
      // Keep whichever the checks are more sure about, but do not extend the TTL —
      // a suggestion that has been waiting a long time should still die on time.
      if (request.confidence > existing.confidence) {
        this.items[this.items.indexOf(existing)] = { ...suggestion, expiresAt: existing.expiresAt };
      }
      this.onDrop?.(suggestion, DropReason.Duplicate);
      return undefined;
    }

    this.items.push(suggestion);
    return suggestion;
  }

  /**
   * Return the single best suggestion eligible to fire at this breakpoint, and
   * remove it from the queue. Eligibility is the relevance policy; ordering is
   * confidence, then age.
   */
  drain(breakpoint: Breakpoint): QueuedSuggestion | undefined {
    this.expire();

    const eligible = this.items.filter((i) =>
      RELEVANCE_POLICY[i.relevance].includes(breakpoint),
    );
    if (eligible.length === 0) return undefined;

    eligible.sort((a, b) =>
      b.confidence !== a.confidence ? b.confidence - a.confidence : a.queuedAt - b.queuedAt,
    );

    const chosen = eligible[0];
    if (!chosen) return undefined;
    this.items.splice(this.items.indexOf(chosen), 1);
    return chosen;
  }

  /**
   * Record that the user rejected a suggestion. Counted by kind, so three
   * rejections of one kind silence that kind — the specific fix for the thing
   * everybody remembers hating about Clippy, whose letter prompt re-fired no
   * matter how many times it was dismissed.
   */
  dismiss(kind: string): number {
    const count = (this.dismissals.get(kind) ?? 0) + 1;
    this.dismissals.set(kind, count);

    if (this.isSuppressed(kind)) {
      for (let i = this.items.length - 1; i >= 0; i--) {
        const item = this.items[i];
        if (item && item.kind === kind) {
          this.items.splice(i, 1);
          this.onDrop?.(item, DropReason.Suppressed);
        }
      }
    }
    return count;
  }

  isSuppressed(kind: string): boolean {
    return (this.dismissals.get(kind) ?? 0) >= DISMISS_STRIKES;
  }

  /** Serialisable dismissal state, for persistence across sessions. */
  dismissalState(): Record<string, number> {
    return Object.fromEntries(this.dismissals);
  }

  clear(): void {
    for (const item of this.items.splice(0)) this.onDrop?.(item, DropReason.Cleared);
  }

  private expire(): void {
    const now = this.now();
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      if (item && item.expiresAt <= now) {
        this.items.splice(i, 1);
        this.onDrop?.(item, DropReason.Expired);
      }
    }
  }
}
