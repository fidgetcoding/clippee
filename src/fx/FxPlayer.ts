import type { FxKind, LabFx } from './types';

/**
 * Plays one entrance or exit on a full-viewport canvas inside Clippee's shadow
 * root. The canvas sits above the page and never takes a click, and Google's
 * page underneath is never moved or touched: everything (cracks, dust, beams)
 * is drawn on this overlay.
 *
 * The canvas holds one pixel per CSS pixel, the same scale as his sprite, and
 * the browser enlarges it for the screen with `image-rendering: pixelated`, so
 * on a 2x display every lab pixel is a crisp 2 x 2 block.
 *
 * The loop runs only while an effect plays and stops the moment it ends.
 */
export class FxPlayer {
  private readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null | undefined;
  private frame = 0;
  private finish: ((completed: boolean) => void) | undefined;

  constructor(parent: ShadowRoot | HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'mrclippy-fx';
    this.canvas.hidden = true;
    this.canvas.setAttribute('aria-hidden', 'true');
    parent.appendChild(this.canvas);
  }

  /** False where a canvas can't draw (an old browser, a test runner). */
  get supported(): boolean {
    if (typeof requestAnimationFrame !== 'function') return false;
    if (this.ctx === undefined) {
      try {
        this.ctx = this.canvas.getContext('2d');
      } catch {
        this.ctx = null;
      }
    }
    return this.ctx !== null;
  }

  get playing(): boolean {
    return this.finish !== undefined;
  }

  /**
   * Resolves true when the effect has run to its end, false if it was cut off.
   * For an appear, the caller shows his sprite in the same task, so the hand
   * from the canvas to the sprite happens inside one painted frame.
   */
  play(fx: LabFx, kind: FxKind, anchor: { x: number; y: number }): Promise<boolean> {
    this.cancel();
    const ctx = this.supported ? this.ctx : null;
    if (!ctx) return Promise.resolve(false);
    const duration = kind === 'appear' ? fx.appearMs : fx.disappearMs;
    const step = fx.fps ? 1000 / fx.fps : 0;
    const spot = { x: Math.round(anchor.x), y: Math.round(anchor.y) };
    this.canvas.hidden = false;

    return new Promise<boolean>((resolve) => {
      this.finish = (completed) => {
        cancelAnimationFrame(this.frame);
        this.finish = undefined;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.canvas.hidden = true;
        resolve(completed);
      };
      let start: number | undefined;
      const tick = (now: number): void => {
        start ??= now;
        const elapsed = now - start;
        if (elapsed >= duration) {
          this.finish?.(true);
          return;
        }
        const at = step ? Math.floor(elapsed / step) * step : elapsed;
        const stage = this.fit(spot);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, stage.w, stage.h);
        ctx.imageSmoothingEnabled = false;
        try {
          fx[kind](ctx, at / duration, stage);
        } catch {
          // A broken frame ends the effect; he still arrives or leaves.
          this.finish?.(false);
          return;
        }
        this.frame = requestAnimationFrame(tick);
      };
      this.frame = requestAnimationFrame(tick);
    });
  }

  cancel(): void {
    this.finish?.(false);
  }

  destroy(): void {
    this.cancel();
    this.canvas.remove();
  }

  /** Match the viewport, which can change mid-effect, in whole CSS pixels. */
  private fit(anchor: { x: number; y: number }): { w: number; h: number; anchor: { x: number; y: number } } {
    const w = Math.max(1, Math.floor(window.innerWidth));
    const h = Math.max(1, Math.floor(window.innerHeight));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
    }
    return { w, h, anchor };
  }
}
