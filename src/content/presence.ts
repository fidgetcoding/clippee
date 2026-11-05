import type { FxKind, LabFx } from '../fx/types';
import { ext } from '../platform';
import { STORAGE_TIMEOUT_MS, within } from '../timeout';

/**
 * Longest the effects library may take to load the first time (a chunk from
 * the extension, usually a few milliseconds). Past it, this entrance or exit
 * goes plain and the load carries on for the next one.
 */
export const EFFECTS_TIMEOUT_MS = 2_000;

/** After X, he comes back on his own. Nate: "he should always reappear again after a certain amount of time". */
export const RETURN_AFTER_MS = 5 * 60_000;

/**
 * Longer than any entrance or exit takes. A request that finds one still
 * running after this long treats it as stuck and starts clean.
 */
export const STUCK_AFTER_MS = 12_000;

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

/** Tell the worker, which keeps the toolbar button in step with him on this tab. */
export function reportAway(away: boolean): void {
  try {
    void ext.runtime.sendMessage({ type: 'mrclippy:away', away }).catch(() => undefined);
  } catch {
    // The extension was reloaded under this page; the new copy reports for itself.
  }
}

/** His return waits until someone can see it: this tab visible and focused. */
export const returnWhenSeen: Pick<PresenceOptions, 'ready' | 'watchReady'> = {
  ready: () => document.visibilityState === 'visible' && document.hasFocus(),
  watchReady: (changed) => {
    document.addEventListener('visibilitychange', changed);
    window.addEventListener('focus', changed);
    return () => {
      document.removeEventListener('visibilitychange', changed);
      window.removeEventListener('focus', changed);
    };
  },
};

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
  /** Whether he is away (or leaving) changed. The toolbar button follows it. */
  readonly onAway?: (away: boolean) => void;
  /**
   * Coming back on his own waits for a reader: the tab visible and focused.
   * `watch` calls back when that may have changed and returns an unsubscribe.
   */
  readonly ready?: () => boolean;
  readonly watchReady?: (changed: () => void) => () => void;
  readonly returnAfterMs?: number;
  readonly now?: () => number;
}

export type Where = 'present' | 'away';

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
  private busySince = 0;
  /** Bumped by `force`, so an effect still running from before can never land. */
  private generation = 0;
  private arrivedOnce = false;
  private disposed = false;
  private returnTimer: ReturnType<typeof setTimeout> | undefined;
  private stopWatching: (() => void) | undefined;
  private library: Readonly<Record<string, LabFx>> | undefined;
  private libraryLoad: Promise<Readonly<Record<string, LabFx>>> | undefined;
  /** Resets him if an effect is still "running" long after any could. */
  private watchdog: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: PresenceOptions) {}

  /** Present, or on the way in. */
  get here(): boolean {
    return this.wanted === 'present';
  }

  /** Arrive now (first appearance, the toolbar button, the shortcut). */
  arrive(): void {
    this.clearReturn();
    this.want('present');
    if (this.stuck()) this.force('present');
    else this.run();
  }

  /** Leave, and come back on his own after a while. */
  leave(): void {
    this.want('away');
    if (this.stuck()) {
      this.force('away');
      return;
    }
    this.scheduleReturn();
    this.run();
  }

  /**
   * Settings' Show and Hide: put him there now, whatever state he got into.
   * Any effect is cut off and can never land, the busy flag and his queue are
   * cleared, and he is at rest on his spot or gone. No effect plays: this is
   * the button that has to work.
   */
  force(where: Where): void {
    if (this.disposed) return;
    this.generation++;
    this.busy = false;
    this.clearWatchdog();
    this.options.player.cancel();
    this.clearReturn();
    this.options.agent.hide(true);
    this.where = where;
    this.want(where, true);
    if (where === 'away') {
      this.scheduleReturn();
      return;
    }
    this.options.agent.show(false);
    this.arrivedOnce = true;
    this.options.onArrived?.(true, true);
  }

  private stuck(): boolean {
    return this.busy && (this.options.now ?? Date.now)() - this.busySince > STUCK_AFTER_MS;
  }

  /** Away already (restored from the back/forward cache hidden); still comes back. */
  startAway(): void {
    this.where = 'away';
    this.want('away', true);
    this.agentHide();
    this.scheduleReturn();
  }

  private want(where: Where, always = false): void {
    if (this.wanted === where && !always) return;
    this.wanted = where;
    this.options.onAway?.(where === 'away');
  }

  toggle(): void {
    if (this.here) this.leave();
    else this.arrive();
  }

  dispose(): void {
    this.disposed = true;
    this.clearReturn();
    this.clearWatchdog();
    this.options.player.cancel();
  }

  private clearWatchdog(): void {
    if (this.watchdog !== undefined) clearTimeout(this.watchdog);
    this.watchdog = undefined;
  }

  private scheduleReturn(): void {
    this.clearReturn();
    this.returnTimer = setTimeout(() => {
      this.returnTimer = undefined;
      if (!this.disposed) this.returnWhenReady();
    }, this.options.returnAfterMs ?? RETURN_AFTER_MS);
  }

  /**
   * An entrance nobody sees is wasted, and one under the toolbar popup is
   * covered: with the tab hidden or not focused, he waits for the reader.
   */
  private returnWhenReady(): void {
    const { ready, watchReady } = this.options;
    if (!ready || !watchReady || ready()) {
      this.arrive();
      return;
    }
    this.stopWatching = watchReady(() => {
      if (this.disposed || this.wanted === 'present' || !ready()) return;
      this.arrive();
    });
  }

  private clearReturn(): void {
    if (this.returnTimer !== undefined) clearTimeout(this.returnTimer);
    this.returnTimer = undefined;
    this.stopWatching?.();
    this.stopWatching = undefined;
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
      this.busySince = (this.options.now ?? Date.now)();
      const generation = this.generation;
      // Nothing below should be able to hang, but if anything ever does, he
      // does not stay hidden waiting for someone to click: he is reset to
      // wherever he was last asked to be.
      this.clearWatchdog();
      this.watchdog = setTimeout(() => {
        this.watchdog = undefined;
        if (generation === this.generation && this.busy && !this.disposed) this.force(this.wanted);
      }, STUCK_AFTER_MS);
      void this.animate(target, generation).finally(() => {
        if (generation !== this.generation) return;
        this.clearWatchdog();
        this.busy = false;
        this.run();
      });
      return;
    }
  }

  private plain(): boolean {
    return this.options.reducedMotion() || !this.options.player.supported;
  }

  private async animate(target: Where, generation: number): Promise<void> {
    const kind: FxKind = target === 'present' ? 'appear' : 'disappear';
    const anchor = { ...this.options.agent.spot };
    // He is drawn on the overlay for the whole effect; his sprite stays out of the way.
    this.agentHide();
    try {
      // Each wait is bounded: storage stranded by an extension reload never answers.
      const id = await within(() => this.options.next(kind), STORAGE_TIMEOUT_MS);
      // A load that failed is tried again next time, not remembered as failed.
      this.libraryLoad ??= Promise.resolve().then(() => this.options.effects()).catch((error: unknown) => {
        this.libraryLoad = undefined;
        throw error;
      });
      this.library ??= await within(this.libraryLoad, EFFECTS_TIMEOUT_MS);
      const fx = id === undefined ? undefined : this.library?.[id];
      if (fx && !this.disposed && generation === this.generation) await this.options.player.play(fx, kind, anchor);
    } catch {
      // No effect this time. He still goes where he was going.
    }
    if (!this.disposed && generation === this.generation) this.land(target, false);
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
