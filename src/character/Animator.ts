import {
  AnimatorState,
  type AnimationEndCallback,
  type Frame,
  type LoadedPack,
  type Animation,
} from './types';

/**
 * Steps a sprite-sheet animation, one frame at a time, honouring probabilistic
 * frame branching.
 *
 * Ported from clippy.js `src/animator.js` (MIT) to typed vanilla DOM. Behavioural
 * differences from the original, all deliberate:
 *  - the step loop can actually be stopped (`stop()`); the original leaves a
 *    `setTimeout` chain running for the lifetime of the page
 *  - sounds are opt-in and default to muted
 *  - guards against a zero-frame animation instead of producing NaN indices
 */
export class Animator {
  private readonly overlays: HTMLElement[] = [];
  private readonly sounds = new Map<string, HTMLAudioElement>();

  private currentAnimation: Animation | undefined;
  private currentFrame: Frame | undefined;
  private currentFrameIndex = 0;
  private exiting = false;
  private started = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private endCallback: AnimationEndCallback | undefined;

  /** Name of the animation currently playing, if any. */
  currentAnimationName: string | undefined;

  /** When false, `sound` keys on frames are ignored. */
  soundEnabled = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly pack: LoadedPack,
  ) {
    const [w, h] = pack.data.framesize;

    this.style(this.root, w, h, pack.spriteUrl);
    this.overlays.push(this.root);

    // Overlay layers nest inside one another, matching the original's DOM shape.
    let parent: HTMLElement = this.root;
    for (let i = 1; i < pack.data.overlayCount; i++) {
      const layer = document.createElement('div');
      this.style(layer, w, h, pack.spriteUrl);
      parent.appendChild(layer);
      this.overlays.push(layer);
      parent = layer;
    }
  }

  private style(el: HTMLElement, w: number, h: number, url: string): void {
    el.style.display = 'none';
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.background = `url("${url}") no-repeat`;
  }

  /** Names of every animation in the loaded pack. */
  animations(): string[] {
    return Object.keys(this.pack.data.animations);
  }

  has(name: string): boolean {
    return Object.hasOwn(this.pack.data.animations, name);
  }

  /** Register audio for frames that reference a sound key. */
  preloadSounds(urls: Readonly<Record<string, string>>): void {
    for (const key of this.pack.data.sounds) {
      const url = urls[key];
      if (url) this.sounds.set(key, new Audio(url));
    }
  }

  /**
   * Begin `name`. Returns false if the pack has no such animation.
   * `onEnd` fires once the animation reaches its final frame.
   */
  play(name: string, onEnd?: AnimationEndCallback): boolean {
    const animation = this.pack.data.animations[name];
    if (!animation || animation.frames.length === 0) return false;

    this.exiting = false;
    this.currentAnimation = animation;
    this.currentAnimationName = name;
    this.currentFrameIndex = 0;
    this.currentFrame = undefined;
    this.endCallback = onEnd;

    if (!this.started) {
      this.started = true;
      this.step();
    }
    return true;
  }

  /**
   * Ask a holding animation to wind down. Frames carrying `exitBranch` will jump
   * to their exit path on the next step.
   */
  exit(): void {
    this.exiting = true;
  }

  pause(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  resume(): void {
    if (this.timer === undefined && this.currentAnimation) this.step();
  }

  /** Stop stepping entirely and hide every layer. */
  stop(): void {
    this.pause();
    this.started = false;
    this.currentAnimation = undefined;
    this.currentAnimationName = undefined;
    this.currentFrame = undefined;
    for (const layer of this.overlays) layer.style.display = 'none';
  }

  private atLastFrame(): boolean {
    const animation = this.currentAnimation;
    if (!animation) return true;
    return this.currentFrameIndex >= animation.frames.length - 1;
  }

  /**
   * Resolve the next frame index.
   *
   * Precedence, matching the original: exit branch when winding down, then a
   * weighted random branch, then simple advance. The weighted roll subtracts each
   * branch's weight as it goes, so weights are relative shares of 100.
   */
  private nextFrameIndex(): number {
    if (!this.currentAnimation) return 0;
    if (!this.currentFrame) return 0;

    const frame = this.currentFrame;

    if (this.exiting && frame.exitBranch !== undefined) return frame.exitBranch;

    if (frame.branching) {
      let roll = Math.random() * 100;
      for (const branch of frame.branching.branches) {
        if (roll <= branch.weight) return branch.frameIndex;
        roll -= branch.weight;
      }
    }

    return this.currentFrameIndex + 1;
  }

  private draw(): void {
    const images = this.currentFrame?.images ?? [];
    for (let i = 0; i < this.overlays.length; i++) {
      const layer = this.overlays[i];
      if (!layer) continue;
      const offset = images[i];
      if (offset) {
        layer.style.backgroundPosition = `${-offset[0]}px ${-offset[1]}px`;
        layer.style.display = 'block';
      } else {
        layer.style.display = 'none';
      }
    }
  }

  private playSound(): void {
    if (!this.soundEnabled) return;
    const key = this.currentFrame?.sound;
    if (!key) return;
    void this.sounds.get(key)?.play().catch(() => {
      // Autoplay policy can reject; a silent character is better than a thrown error.
    });
  }

  private step(): void {
    const animation = this.currentAnimation;
    if (!animation) return;

    const lastIndex = animation.frames.length - 1;
    const nextIndex = Math.min(this.nextFrameIndex(), lastIndex);
    const frameChanged = !this.currentFrame || this.currentFrameIndex !== nextIndex;
    this.currentFrameIndex = nextIndex;

    // Hold the final frame when the animation uses exit branching — that frame is
    // a waiting state, not a real frame to advance past.
    if (!(this.atLastFrame() && animation.useExitBranching)) {
      this.currentFrame = animation.frames[this.currentFrameIndex];
    }

    this.draw();
    this.playSound();

    const duration = this.currentFrame?.duration ?? 100;
    this.timer = setTimeout(() => this.step(), duration);

    if (this.endCallback && frameChanged && this.atLastFrame()) {
      const state =
        animation.useExitBranching && !this.exiting
          ? AnimatorState.Waiting
          : AnimatorState.Exited;
      this.endCallback(this.currentAnimationName ?? '', state);
    }
  }
}
