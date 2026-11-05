/** The stage an effect draws on: the whole viewport, in CSS pixels. */
export interface FxStage {
  readonly w: number;
  readonly h: number;
  /** Top-left of his 124 x 93 box when he stands at rest. */
  readonly anchor: { readonly x: number; readonly y: number };
}

export type FxKind = 'appear' | 'disappear';

/**
 * One entrance-and-exit pair from the animation lab. Both halves are pure
 * functions of t (0..1): no timers, no state, fixed seeds. An appear ends on
 * his rest sprite at the anchor; a disappear ends on an empty stage.
 */
export interface LabFx {
  readonly id: string;
  readonly name: string;
  readonly appearMs: number;
  readonly disappearMs: number;
  /** The frame rate the lab stepped t at. Absent means every display frame. */
  readonly fps?: number;
  appear(ctx: CanvasRenderingContext2D, t: number, stage: FxStage): void;
  disappear(ctx: CanvasRenderingContext2D, t: number, stage: FxStage): void;
}
