import { ShuffleBag, type BagStore } from './shuffleBag';

/**
 * Picks idle animations and decides when the next one fires.
 *
 * The cadence is lifted from Live2D's blink model, which has solved ambient
 * liveness better than anything in the desktop-mascot space: a nominal interval,
 * but the next event scheduled uniformly across roughly twice that window rather
 * than on a fixed beat. A predictable loop reads as a GIF; a stochastic one reads
 * as alive.
 */
export interface IdleSchedulerOptions {
  /** Nominal seconds between idle animations. */
  readonly intervalMs?: number;
  /** Source of randomness. Injectable so the cadence can be tested. */
  readonly random?: () => number;
  /** Where the idle bag keeps its place between pages. */
  readonly store?: BagStore;
}

const DEFAULT_INTERVAL_MS = 4_000;

export class IdleScheduler {
  private readonly intervalMs: number;
  private readonly random: () => number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly bag: ShuffleBag;

  constructor(
    idleNames: readonly string[],
    private readonly play: (name: string) => void,
    options: IdleSchedulerOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.random = options.random ?? Math.random;
    this.bag = new ShuffleBag(idleNames, options.store, this.random);
  }

  /**
   * Delay before the next idle, uniform in [0, 2 * interval - 1s).
   * Never a fixed beat — that is the whole point.
   */
  nextDelayMs(): number {
    return this.random() * (2 * this.intervalMs - 1_000);
  }

  /**
   * Choose an idle animation from the bag: every idle plays once before any
   * plays again, and never the same one twice in a row.
   */
  pick(): string | undefined {
    return this.bag.next();
  }

  /** Schedule the next idle. Safe to call repeatedly; only one timer is live. */
  schedule(): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const name = this.pick();
      if (name) this.play(name);
    }, this.nextDelayMs());
  }

  cancel(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
