import { Breakpoint, MIN_SILENCE_MS } from './types';

export type BreakpointListener = (breakpoint: Breakpoint) => void;

export interface BreakpointDetectorOptions {
  readonly now?: () => number;
  readonly minSilenceMs?: number;
  /** How often to check whether the writer has gone quiet. */
  readonly pollMs?: number;
}

const DEFAULT_POLL_MS = 2_000;
/** Vertical distance that counts as scrolling back to re-read rather than drifting. */
const REREAD_SCROLL_PX = 400;

/**
 * Turns raw interaction into perceptual seams.
 *
 * Two rules do most of the work here, and both are counter-intuitive enough to
 * be worth restating at the call site:
 *
 *  1. **Sentence completion is not a seam.** There is deliberately no handler
 *     for "typed a period". Sentence-level editing is a blur of typing, erasing,
 *     selecting and scrolling, and observers reliably do not perceive a break in
 *     it. A writer who has just typed a period is mid-blur.
 *
 *  2. **Speak on the return, not on the way out.** Losing focus emits nothing.
 *     Regaining it emits Coarse. Firing into a task switch deepens the diversion;
 *     post-boundary interventions engaged roughly 52% of the time against 62%
 *     dismissal for mid-task ones.
 *
 * Published detectors ran 52-64% precision in live deployment, so the cost of a
 * false positive has to stay near zero. That is the renderer's job.
 */
export class BreakpointDetector {
  private readonly listeners = new Set<BreakpointListener>();
  private readonly now: () => number;
  private readonly minSilenceMs: number;
  private readonly pollMs: number;

  private lastActivityAt: number;
  private lastScrollY = 0;
  private quietFired = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private detach: Array<() => void> = [];

  constructor(options: BreakpointDetectorOptions = {}) {
    this.now = options.now ?? Date.now;
    this.minSilenceMs = options.minSilenceMs ?? MIN_SILENCE_MS;
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    this.lastActivityAt = this.now();
  }

  on(listener: BreakpointListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Milliseconds since the last keystroke, scroll or selection. */
  silenceMs(): number {
    return this.now() - this.lastActivityAt;
  }

  /** True once the writer has been quiet long enough to be interruptible. */
  get isQuiet(): boolean {
    return this.silenceMs() >= this.minSilenceMs;
  }

  start(target: Document = document): void {
    if (this.timer !== undefined) return;
    this.lastScrollY = window.scrollY;

    const activity = (): void => this.markActivity();

    const onSelectionChange = (): void => {
      this.markActivity();
      const selection = target.getSelection?.();
      // A completed, non-empty selection is a Fine seam — the writer has stopped
      // producing text and started operating on it.
      if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) {
        this.emit(Breakpoint.Fine);
      }
    };

    const onScroll = (): void => {
      const y = window.scrollY;
      const delta = this.lastScrollY - y;
      this.lastScrollY = y;
      this.markActivity();
      // Scrolling back up a meaningful distance reads as re-reading, which is a
      // Medium seam: the writer has left composition and entered review.
      if (delta > REREAD_SCROLL_PX) this.emit(Breakpoint.Medium);
    };

    const onVisibility = (): void => {
      // Nothing on the way out. Only the return is a seam.
      if (target.visibilityState === 'visible') {
        this.markActivity();
        this.emit(Breakpoint.Coarse);
      }
    };

    const onPaste = (): void => {
      this.markActivity();
      this.emit(Breakpoint.Fine);
    };

    target.addEventListener('keydown', activity, true);
    target.addEventListener('selectionchange', onSelectionChange);
    target.addEventListener('paste', onPaste, true);
    target.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('focus', onVisibility);

    this.detach = [
      () => target.removeEventListener('keydown', activity, true),
      () => target.removeEventListener('selectionchange', onSelectionChange),
      () => target.removeEventListener('paste', onPaste, true),
      () => target.removeEventListener('visibilitychange', onVisibility),
      () => window.removeEventListener('scroll', onScroll),
      () => window.removeEventListener('focus', onVisibility),
    ];

    this.timer = setInterval(() => this.pollQuiet(), this.pollMs);
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    for (const off of this.detach) off();
    this.detach = [];
  }

  /** Record interaction. Resets the quiet window. */
  markActivity(): void {
    this.lastActivityAt = this.now();
    this.quietFired = false;
  }

  /**
   * A long enough pause is a Medium seam — the writer has stopped, and pauses at
   * larger textual units are where higher-order revision happens. Fires once per
   * quiet period, not repeatedly.
   */
  private pollQuiet(): void {
    if (!this.isQuiet || this.quietFired) return;
    this.quietFired = true;
    this.emit(Breakpoint.Medium);
  }

  private emit(breakpoint: Breakpoint): void {
    for (const listener of this.listeners) listener(breakpoint);
  }
}
