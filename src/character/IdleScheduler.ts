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
}

const DEFAULT_INTERVAL_MS = 4_000;

export class IdleScheduler {
  private readonly intervalMs: number;
  private readonly random: () => number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastPlayed: string | undefined;

  constructor(
    private readonly idleNames: readonly string[],
    private readonly play: (name: string) => void,
    options: IdleSchedulerOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.random = options.random ?? Math.random;
  }

  /**
   * Delay before the next idle, uniform in [0, 2 * interval - 1s).
   * Never a fixed beat — that is the whole point.
   */
  nextDelayMs(): number {
    return this.random() * (2 * this.intervalMs - 1_000);
  }

  /**
   * Choose an idle animation, avoiding an immediate repeat so the same gesture
   * never fires twice in a row when several are available.
   */
  pick(): string | undefined {
    if (this.idleNames.length === 0) return undefined;
    if (this.idleNames.length === 1) return this.idleNames[0];

    const candidates = this.idleNames.filter((n) => n !== this.lastPlayed);
    const pool = candidates.length > 0 ? candidates : this.idleNames;
    const chosen = pool[Math.floor(this.random() * pool.length) % pool.length];
    this.lastPlayed = chosen;
    return chosen;
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
