import type { FxKind, LabFx } from '../fx/types';

/** After X, he comes back on his own. Nate: "he should always reappear again after a certain amount of time". */
export const RETURN_AFTER_MS = 5 * 60_000;

/** The first Greeting frame after he has drawn himself in from a bare wire: the hop and the wave. */
export const GREETING_WAVE_FRAME = 22;

/**
 * Asking for less motion swaps the entrances and exits for the pack's plain
 * Show and Hide. Where the question can't be asked, assume less.
 */
export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia !== 'function' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The parts of the Agent that arriving and leaving need. */
export interface PresenceAgent {
  readonly isVisible: boolean;
  /** Top-left of his sprite box, in viewport pixels. */
  readonly spot: { x: number; y: number };
  /** On screen with the pack's own Show; `false` puts him straight at rest. */
  show(animated?: boolean): void;
  /** Off screen; `true` skips the pack's Hide. */
  hide(immediate?: boolean): void;
}

export interface PresencePlayer {
  readonly supported: boolean;
  play(fx: LabFx, kind: FxKind, anchor: { x: number; y: number }): Promise<boolean>;
  cancel(): void;
}

export interface PresenceOptions {
  readonly agent: PresenceAgent;
  readonly player: PresencePlayer;
  /** The next effect id for an entrance or an exit (the shuffle bags). */
  readonly next: (kind: FxKind) => Promise<string>;
  /** Every effect by id. Called once, the first time one plays. */
  readonly effects: () => Promise<Readonly<Record<string, LabFx>>>;
  /** True when the plain Show and Hide should play instead of an effect. */
  readonly reducedMotion: () => boolean;
  /**
   * He has just landed. `returning` is false only for his first arrival on the
   * page; `entered` is true when an entrance brought him (he is already at rest).
   */
  readonly onArrived?: (returning: boolean, entered: boolean) => void;
  readonly returnAfterMs?: number;
}

type Where = 'present' | 'away';

/**
 * Where he is, and how he gets there. Every arrival is a random entrance and
 * every departure a random exit, unless the reader asked for less motion, in
 * which case the pack's plain Show and Hide play.
 *
 * Requests that land mid-effect are not dropped: the last one wins once the
 * current effect finishes. A departure the reader asked for (X, the shortcut)
 * starts the clock on his return.
 */
export class Presence {
  private where: Where = 'away';
  private wanted: Where = 'away';
  private busy = false;
  private arrivedOnce = false;
  private disposed = false;
  private returnTimer: ReturnType<typeof setTimeout> | undefined;
  private library: Readonly<Record<string, LabFx>> | undefined;

  constructor(private readonly options: PresenceOptions) {}

  /** Present, or on the way in. */
  get here(): boolean {
    return this.wanted === 'present';
  }

  /** Arrive now (first appearance, the toolbar button, the shortcut). */
  arrive(): void {
    this.clearReturn();
    this.wanted = 'present';
    this.run();
  }

  /** Leave, and come back on his own after a while. */
  leave(): void {
    this.wanted = 'away';
    this.scheduleReturn();
    this.run();
  }

  /** Away already (restored from the back/forward cache hidden); still comes back. */
  startAway(): void {
    this.where = this.wanted = 'away';
    this.agentHide();
    this.scheduleReturn();
  }

  toggle(): void {
    if (this.here) this.leave();
    else this.arrive();
  }

  dispose(): void {
    this.disposed = true;
    this.clearReturn();
    this.options.player.cancel();
  }

  private scheduleReturn(): void {
    this.clearReturn();
    this.returnTimer = setTimeout(() => {
      this.returnTimer = undefined;
      if (!this.disposed) this.arrive();
    }, this.options.returnAfterMs ?? RETURN_AFTER_MS);
  }

  private clearReturn(): void {
    if (this.returnTimer !== undefined) clearTimeout(this.returnTimer);
    this.returnTimer = undefined;
  }

  /**
   * One effect at a time, then catch up with whatever was asked for last. The
   * plain path finishes synchronously, so with reduced motion he is on screen
   * the moment `arrive()` returns.
   */
  private run(): void {
    if (this.busy || this.disposed) return;
    while (this.wanted !== this.where) {
      const target = this.wanted;
      if (this.plain()) {
        this.land(target, true);
        continue;
      }
      this.busy = true;
      void this.animate(target).finally(() => {
        this.busy = false;
        this.run();
      });
      return;
    }
  }

  private plain(): boolean {
    return this.options.reducedMotion() || !this.options.player.supported;
  }

  private async animate(target: Where): Promise<void> {
    const kind: FxKind = target === 'present' ? 'appear' : 'disappear';
    const anchor = { ...this.options.agent.spot };
    // He is drawn on the overlay for the whole effect; his sprite stays out of the way.
    this.agentHide();
    try {
      const id = await this.options.next(kind);
      this.library ??= await this.options.effects();
      const fx = this.library[id];
      if (fx && !this.disposed) await this.options.player.play(fx, kind, anchor);
    } catch {
      // No effect this time. He still goes where he was going.
    }
    if (!this.disposed) this.land(target, false);
  }

  /**
   * Put him where an effect ends: at rest on his spot, or gone. `plain` plays
   * the pack's Show or Hide on the way, for when no effect ran.
   */
  private land(target: Where, plain: boolean): void {
    this.where = target;
    if (target === 'away') {
      this.agentHide(plain);
      return;
    }
    this.options.agent.show(plain);
    const returning = this.arrivedOnce;
    this.arrivedOnce = true;
    this.options.onArrived?.(returning, !plain);
  }

  private agentHide(animated = false): void {
    if (this.options.agent.isVisible) this.options.agent.hide(!animated);
  }
}
