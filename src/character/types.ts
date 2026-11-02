/**
 * Character pack format.
 *
 * This is the data shape used by clippy.js (MIT). The shape is adopted
 * deliberately: it is a proven sprite-sheet + branching-animation format, and an
 * idea rather than a copyrightable asset. The Clippy *artwork* that ships in
 * `src/packs/clippy/` is Microsoft's and is not licensed — fine for a personal
 * build, swap for original art before any public release.
 */

/** Top-left pixel coordinate of a frame within the sprite sheet. */
export type SpriteOffset = readonly [x: number, y: number];

export interface Branch {
  /** Relative weight, 0-100, evaluated against a single random roll. */
  readonly weight: number;
  readonly frameIndex: number;
}

export interface Branching {
  readonly branches: readonly Branch[];
}

export interface Frame {
  /** Milliseconds this frame is held. */
  readonly duration: number;
  /** One offset per overlay layer. Absent or empty means "draw nothing". */
  readonly images?: readonly SpriteOffset[];
  /** Key into `Pack.sounds`. */
  readonly sound?: string;
  /** Frame to jump to when the animation has been asked to exit early. */
  readonly exitBranch?: number;
  /** Probabilistic next-frame selection. This is what makes idles feel alive. */
  readonly branching?: Branching;
}

export interface Animation {
  readonly frames: readonly Frame[];
  /**
   * When true, the final frame is a holding state: the animator reports WAITING
   * rather than EXITED and keeps the last frame on screen until `exit()`.
   */
  readonly useExitBranching?: boolean;
}

export interface Pack {
  /** Number of stacked sprite layers. Clippy uses 1. */
  readonly overlayCount: number;
  readonly framesize: readonly [width: number, height: number];
  readonly sounds: readonly string[];
  readonly animations: Readonly<Record<string, Animation>>;
}

/** Terminal state reported to an animation's completion callback. */
export const AnimatorState = {
  /** Animation reached a holding frame and is waiting for `exit()`. */
  Waiting: 'waiting',
  /** Animation ran to completion. */
  Exited: 'exited',
} as const;

export type AnimatorState = (typeof AnimatorState)[keyof typeof AnimatorState];

export type AnimationEndCallback = (name: string, state: AnimatorState) => void;

/** A loaded pack plus the resolved URL of its sprite sheet. */
export interface LoadedPack {
  readonly name: string;
  readonly data: Pack;
  readonly spriteUrl: string;
}
