import { Animator } from './Animator';
import { Balloon } from './Balloon';
import { IdleScheduler } from './IdleScheduler';
import { Queue } from './Queue';
import { AnimatorState, type LoadedPack } from './types';

/** Longest he can take to leave before he is just removed. */
const HIDE_BACKSTOP_MS = 2_000;

export interface AgentOptions {
  /** Starting viewport position, in pixels. */
  readonly position?: { x: number; y: number };
  readonly idleIntervalMs?: number;
  readonly onClick?: () => void;
  /** The X on the character. Dismissing must always be one click away. */
  readonly onDismiss?: () => void;
  /** After a drag ends, with where he was dropped. Used to remember the spot. */
  readonly onMoved?: (position: { x: number; y: number }) => void;
}

/**
 * The character's public surface.
 *
 * Everything that puts the character on screen goes through here, and nothing
 * outside `scheduler/Renderer` should call it. That boundary exists from the
 * first commit on purpose: the interruption research is unambiguous that a
 * proactive assistant must schedule rather than trigger, and retrofitting that
 * rule after producers have learned to call `play()` directly is a rewrite.
 */
export class Agent {
  readonly root: HTMLElement;
  readonly balloon: Balloon;

  private readonly sprite: HTMLElement;
  private readonly animator: Animator;
  private readonly queue: Queue;
  private readonly idle: IdleScheduler;

  private position: { x: number; y: number };
  private dragOrigin: { x: number; y: number; px: number; py: number } | undefined;
  private shown = false;
  private destroyed = false;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    pack: LoadedPack,
    options: AgentOptions = {},
  ) {
    const [w, h] = pack.data.framesize;

    this.root = document.createElement('div');
    this.root.className = 'mrclippy-agent';
    this.root.setAttribute('role', 'button');
    this.root.setAttribute('tabindex', '0');
    this.root.setAttribute('aria-label', 'Clippee');
    this.root.hidden = true;

    this.sprite = document.createElement('div');
    this.sprite.className = 'mrclippy-sprite';
    this.root.appendChild(this.sprite);

    // Getting rid of him has to be visible and instant. The original's
    // best-remembered failure was that dismissing it did not take.
    if (options.onDismiss) {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'mrclippy-agent-close';
      close.title = 'Send Clippee away';
      close.setAttribute('aria-label', 'Send Clippee away');
      close.textContent = '\u2715';
      close.addEventListener('pointerdown', (e) => e.stopPropagation());
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        options.onDismiss?.();
      });
      this.root.appendChild(close);
    }

    this.animator = new Animator(this.sprite, pack);
    this.balloon = new Balloon(this.root);

    this.queue = new Queue(() => { if (this.shown && !this.destroyed) this.idle.schedule(); });
    this.idle = new IdleScheduler(
      this.animator.animations().filter((n) => n.startsWith('Idle')),
      (name) => this.animator.play(name),
      options.idleIntervalMs !== undefined ? { intervalMs: options.idleIntervalMs } : {},
    );

    const fallback = {
      x: Math.max(16, window.innerWidth - w - 32),
      y: Math.max(16, window.innerHeight - h - 32),
    };
    // A remembered spot from a bigger window could be off screen; keep him on it.
    this.position = options.position
      ? {
          x: Math.min(Math.max(0, options.position.x), Math.max(0, window.innerWidth - w)),
          y: Math.min(Math.max(0, options.position.y), Math.max(0, window.innerHeight - h)),
        }
      : fallback;
    this.applyPosition();

    this.wireInteraction(options.onClick, options.onMoved);
  }

  /** Animation names available in the loaded pack. */
  animations(): string[] {
    return this.animator.animations();
  }

  get element(): HTMLElement {
    return this.root;
  }

  get isVisible(): boolean {
    return this.shown;
  }

  /** Top-left of his sprite box, in viewport pixels. Entrances and exits start here. */
  get spot(): { x: number; y: number } {
    return { ...this.position };
  }

  /**
   * `animated` plays the pack's Show. Without it he is simply there, at rest:
   * that is how an entrance ends, since the entrance already brought him in.
   */
  show(animated = true): void {
    if (this.shown || this.destroyed) return;
    if (this.hideTimer !== undefined) clearTimeout(this.hideTimer);
    this.hideTimer = undefined;
    this.shown = true;
    this.root.hidden = false;
    const entrance = animated ? 'Show' : 'RestPose';
    if (this.animator.has(entrance)) void this.play(entrance);
    else this.idle.schedule();
  }

  /**
   * `immediate` skips the exit animation — use it for Escape. Either way he
   * goes now: whatever was playing is cut off rather than waited on, because a
   * long animation ahead of Hide is what made the X look broken.
   */
  hide(immediate = false): void {
    if (this.hideTimer !== undefined) clearTimeout(this.hideTimer);
    this.hideTimer = undefined;
    this.shown = false;
    this.idle.cancel();
    this.balloon.hide();
    this.queue.reset();
    this.animator.stop();
    if (immediate || !this.animator.has('Hide')) {
      this.root.hidden = true;
      return;
    }
    const finish = (): void => {
      if (this.hideTimer !== undefined) clearTimeout(this.hideTimer);
      this.hideTimer = undefined;
      if (this.shown || this.destroyed) return;
      this.animator.stop();
      this.root.hidden = true;
    };
    this.queue.push((done) => {
      const started = this.animator.play('Hide', () => {
        finish();
        done();
      });
      if (!started) {
        finish();
        done();
      }
    });
    // Backstop in case the exit animation never reports back.
    if (!this.root.hidden) this.hideTimer = setTimeout(finish, HIDE_BACKSTOP_MS);
  }

  /**
   * Queue an animation. Resolves when it finishes or is skipped. `from` starts
   * it partway in, when its opening would repeat what is already on screen.
   */
  play(name: string, from = 0): Promise<void> {
    return new Promise((resolve) => {
      if (this.destroyed || !this.animator.has(name)) {
        resolve();
        return;
      }
      this.idle.cancel();
      this.queue.push((done) => {
        const finish = (): void => {
          done();
          resolve();
        };
        const started = this.animator.play(name, (_n, state) => {
          if (state === AnimatorState.Exited) finish();
        }, from);
        if (!started) finish();
      }, resolve);
    });
  }

  /**
   * Queue a holding animation that runs until `until` settles, then winds down
   * along its exit branches. Thinking loops forever on its own; this ends it.
   * If `until` settles before the animation's turn comes, it is skipped.
   */
  playUntil(name: string, until: Promise<unknown>): Promise<void> {
    let settled = false;
    const windDown = (): void => {
      settled = true;
      if (this.animator.currentAnimationName === name) this.animator.exit();
    };
    until.then(windDown, windDown);
    return new Promise((resolve) => {
      if (this.destroyed || !this.animator.has(name)) {
        resolve();
        return;
      }
      this.idle.cancel();
      this.queue.push((done) => {
        const finish = (): void => {
          done();
          resolve();
        };
        if (settled) {
          finish();
          return;
        }
        const started = this.animator.play(name, (_n, state) => {
          if (state === AnimatorState.Exited) finish();
        });
        if (!started) finish();
      }, resolve);
    });
  }

  /**
   * A one-line nudge that invites a click, played once when he first appears.
   * Without it he is a decoration nobody realises is interactive.
   */
  nudge(text: string, holdMs = 7_000): void {
    void this.play('GetAttention');
    void this.speak(text, holdMs);
  }

  /** Queue a spoken line. `holdMs` of 0 leaves the balloon open. */
  speak(text: string, holdMs = 0): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    return new Promise((resolve) => {
      this.queue.push((done) => {
        // The balloon refuses this while locked, but skip the hide-timer too —
        // otherwise a stale greeting can still schedule a dismissal for content
        // the user opened after it was queued.
        if (!this.balloon.isLocked) {
          this.balloon.say(text);
          if (holdMs > 0) this.balloon.hideAfter(holdMs);
        }
        done();
        resolve();
      }, resolve);
    });
  }

  /**
   * Drop everything queued but not yet started. Called when the user does
   * something deliberate, so a greeting queued seconds ago cannot land on top
   * of the panel they just opened.
   */
  interrupt(): void {
    this.queue.clear();
  }

  moveTo(x: number, y: number): void {
    this.position = { x, y };
    this.applyPosition();
    if (this.balloon.visible) this.balloon.position();
  }

  destroy(): void {
    this.destroyed = true;
    this.shown = false;
    if (this.hideTimer !== undefined) clearTimeout(this.hideTimer);
    this.hideTimer = undefined;
    this.balloon.hide();
    this.idle.cancel();
    this.queue.reset();
    this.animator.stop();
    this.root.remove();
    this.balloon.el.remove();
  }

  private applyPosition(): void {
    this.root.style.left = `${this.position.x}px`;
    this.root.style.top = `${this.position.y}px`;
  }

  private wireInteraction(
    onClick?: () => void,
    onMoved?: (position: { x: number; y: number }) => void,
  ): void {
    let moved = false;

    this.root.addEventListener('pointerdown', (e: PointerEvent) => {
      moved = false;
      this.dragOrigin = {
        x: this.position.x,
        y: this.position.y,
        px: e.clientX,
        py: e.clientY,
      };
      this.root.setPointerCapture(e.pointerId);
    });

    this.root.addEventListener('pointermove', (e: PointerEvent) => {
      const origin = this.dragOrigin;
      if (!origin) return;
      const dx = e.clientX - origin.px;
      const dy = e.clientY - origin.py;
      // A few pixels of slop so a click with a shaky hand is still a click.
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      this.moveTo(origin.x + dx, origin.y + dy);
    });

    const release = (e: PointerEvent): void => {
      if (!this.dragOrigin) return;
      this.dragOrigin = undefined;
      if (this.root.hasPointerCapture(e.pointerId)) this.root.releasePointerCapture(e.pointerId);
      if (!moved) onClick?.();
      else onMoved?.({ ...this.position });
    };

    this.root.addEventListener('pointerup', release);
    this.root.addEventListener('pointercancel', release);

    this.root.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick?.();
      }
      if (e.key === 'Escape') this.balloon.hide();
    });
  }
}
