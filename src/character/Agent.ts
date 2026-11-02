import { Animator } from './Animator';
import { Balloon } from './Balloon';
import { IdleScheduler } from './IdleScheduler';
import { Queue } from './Queue';
import { AnimatorState, type LoadedPack } from './types';

export interface AgentOptions {
  /** Starting viewport position, in pixels. */
  readonly position?: { x: number; y: number };
  readonly idleIntervalMs?: number;
  readonly onClick?: () => void;
  /** The X on the character. Dismissing must always be one click away. */
  readonly onDismiss?: () => void;
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

  constructor(
    pack: LoadedPack,
    options: AgentOptions = {},
  ) {
    const [w, h] = pack.data.framesize;

    this.root = document.createElement('div');
    this.root.className = 'mrclippy-agent';
    this.root.setAttribute('role', 'button');
    this.root.setAttribute('tabindex', '0');
    this.root.setAttribute('aria-label', 'Mr. Clippy');
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
      close.title = 'Send Mr. Clippy away';
      close.setAttribute('aria-label', 'Send Mr. Clippy away');
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

    this.queue = new Queue(() => this.idle.schedule());
    this.idle = new IdleScheduler(
      this.animator.animations().filter((n) => n.startsWith('Idle')),
      (name) => this.animator.play(name),
      options.idleIntervalMs !== undefined ? { intervalMs: options.idleIntervalMs } : {},
    );

    this.position = options.position ?? {
      x: Math.max(16, window.innerWidth - w - 32),
      y: Math.max(16, window.innerHeight - h - 32),
    };
    this.applyPosition();

    this.wireInteraction(options.onClick);
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

  show(): void {
    if (this.shown) return;
    this.shown = true;
    this.root.hidden = false;
    if (this.animator.has('Show')) this.play('Show');
    else this.idle.schedule();
  }

  /** `immediate` skips the exit animation — use it for Escape. */
  hide(immediate = false): void {
    this.shown = false;
    this.idle.cancel();
    this.balloon.hide();
    if (immediate || !this.animator.has('Hide')) {
      this.animator.stop();
      this.root.hidden = true;
      return;
    }
    this.queue.clear();
    this.queue.push((done) => {
      this.animator.play('Hide', () => {
        this.animator.stop();
        this.root.hidden = true;
        done();
      });
    });
  }

  /** Queue an animation. Resolves when it finishes or is skipped. */
  play(name: string): Promise<void> {
    return new Promise((resolve) => {
      if (!this.animator.has(name)) {
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
        });
        if (!started) finish();
      });
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
      });
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
    this.idle.cancel();
    this.queue.clear();
    this.animator.stop();
    this.root.remove();
    this.balloon.el.remove();
  }

  private applyPosition(): void {
    this.root.style.left = `${this.position.x}px`;
    this.root.style.top = `${this.position.y}px`;
  }

  private wireInteraction(onClick?: () => void): void {
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
