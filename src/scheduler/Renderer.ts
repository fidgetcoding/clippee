import type { Agent } from '../character/Agent';
import type { BreakpointDetector } from './BreakpointDetector';
import type { SuggestionQueue } from './SuggestionQueue';
import { MIN_RENDER_GAP_MS, type Breakpoint, type QueuedSuggestion } from './types';

export interface RendererOptions {
  readonly now?: () => number;
  readonly minGapMs?: number;
  /** Animation played when Clippee has something. Non-looping, single gesture. */
  readonly attentionAnimation?: string;
  readonly onShown?: (suggestion: QueuedSuggestion) => void;
  readonly onDismissed?: (suggestion: QueuedSuggestion) => void;
}

/**
 * The only thing in Clippee permitted to put a suggestion on screen.
 *
 * Producers post to the queue; the detector emits seams; this decides whether
 * anything actually happens. Keeping that decision in exactly one place is what
 * makes the interruption policy auditable rather than emergent.
 *
 * The rate cap is deliberately blunt. A patient assistant was preferred by 90% of
 * participants against 47% for an eager variant of the same assistant — and the
 * eager one produced more suggestion-expansions but fewer actual uses. More
 * looking, less using.
 */
export class Renderer {
  private readonly now: () => number;
  private readonly minGapMs: number;
  private readonly attentionAnimation: string;
  private readonly onShown: ((s: QueuedSuggestion) => void) | undefined;
  private readonly onDismissed: ((s: QueuedSuggestion) => void) | undefined;

  private lastRenderAt = 0;
  private current: QueuedSuggestion | undefined;
  private unsubscribe: (() => void) | undefined;
  private muted = false;
  private engaged = false;

  constructor(
    private readonly agent: Agent,
    private readonly queue: SuggestionQueue,
    private readonly detector: BreakpointDetector,
    options: RendererOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.minGapMs = options.minGapMs ?? MIN_RENDER_GAP_MS;
    this.attentionAnimation = options.attentionAnimation ?? 'GetAttention';
    this.onShown = options.onShown;
    this.onDismissed = options.onDismissed;
  }

  start(): void {
    this.unsubscribe ??= this.detector.on((bp) => this.renderAt(bp));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /** Suppress all proactive rendering. Explicit user requests still work. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    // Muting clears a pending suggestion, but never closes a panel the user has
    // open — they muted proactive chatter, not the conversation they started.
    if (muted && this.current) this.dismissCurrent();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /**
   * The user is actively working with the character — panel open, mid-question.
   * Nothing proactive may render until they are done.
   *
   * This is the same principle as the breakpoint policy applied one level up:
   * interrupting someone who is talking to you is worse than interrupting
   * someone who is writing. Candidates keep queueing and expire on their own
   * TTL; they simply do not get a turn.
   */
  setEngaged(engaged: boolean): void {
    this.engaged = engaged;
  }

  get isEngaged(): boolean {
    return this.engaged;
  }

  /** Milliseconds until the rate cap allows another render. */
  cooldownMs(): number {
    return Math.max(0, this.minGapMs - (this.now() - this.lastRenderAt));
  }

  /**
   * Can anything render right now? Four independent gates, all of which must
   * pass: not muted, not engaged with the user, nothing already on screen, and
   * the rate cap satisfied.
   * The silence floor is checked separately because a Coarse seam (returning to
   * the tab) is itself proof the writer is not mid-flow.
   */
  canRender(breakpoint: Breakpoint): boolean {
    if (this.muted) return false;
    if (this.engaged) return false;
    if (this.current) return false;
    if (this.cooldownMs() > 0) return false;
    if (breakpoint !== 'coarse' && !this.detector.isQuiet) return false;
    return true;
  }

  renderAt(breakpoint: Breakpoint): void {
    if (!this.canRender(breakpoint)) return;

    const suggestion = this.queue.drain(breakpoint);
    if (!suggestion) return;

    this.lastRenderAt = this.now();
    this.current = suggestion;

    void this.agent.play(this.attentionAnimation);
    void this.agent.speak(suggestion.text);
    this.onShown?.(suggestion);
  }

  /**
   * Show something the user explicitly asked for. Bypasses the rate cap and the
   * silence floor — neither applies to a request the user made themselves — but
   * still routes through here so one component owns the balloon.
   */
  showOnRequest(text: string, animation?: string): void {
    if (animation) void this.agent.play(animation);
    void this.agent.speak(text);
  }

  /** User rejected the visible suggestion. Costs zero keystrokes by design. */
  dismissCurrent(): void {
    const suggestion = this.current;
    this.current = undefined;
    // Only close the balloon if a suggestion is what is in it. Once the user has
    // opened a panel the balloon belongs to them, and clearing suggestion state
    // must not take their window with it.
    this.hideOwnBalloon();
    if (!suggestion) return;
    this.queue.dismiss(suggestion.kind);
    this.onDismissed?.(suggestion);
  }

  /** User accepted or otherwise resolved the visible suggestion. */
  resolveCurrent(): void {
    this.current = undefined;
    this.hideOwnBalloon();
  }

  /** Close the balloon only if what is in it is ours: a suggestion or nothing locked. */
  private hideOwnBalloon(): void {
    const balloon = this.agent.balloon;
    if (balloon.showingSuggestion || !balloon.isLocked) balloon.hide();
  }

  get visible(): QueuedSuggestion | undefined {
    return this.current;
  }
}
