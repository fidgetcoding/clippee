/** A unit of work that signals its own completion. */
export type QueuedTask = (done: () => void) => void;

/**
 * Serialises character actions so animations never overlap.
 *
 * Ported from clippy.js `src/queue.js` (MIT), with an empty-queue callback so the
 * idle scheduler can take over the moment Mr. Clippy has nothing else to do.
 */
export class Queue {
  private readonly tasks: { run: QueuedTask; cancel?: () => void }[] = [];
  private activeCancel: (() => void) | undefined;
  private active = false;
  /** Bumped by `reset()`, so a task that was running then cannot advance the queue later. */
  private generation = 0;

  constructor(private readonly onEmpty: () => void) {}

  get length(): number {
    return this.tasks.length;
  }

  get busy(): boolean {
    return this.active;
  }

  push(task: QueuedTask, cancel?: () => void): void {
    this.tasks.push({ run: task, cancel });
    if (!this.active) this.next();
  }

  /** Drop everything not yet started. Does not interrupt the running task. */
  clear(): void {
    for (const task of this.tasks.splice(0)) task.cancel?.();
  }

  /**
   * Drop everything, including the running task. Its late `done()` is ignored.
   * For when the user wants him gone now, not after the current animation.
   */
  reset(): void {
    this.clear();
    this.generation += 1;
    this.active = false;
    const cancel = this.activeCancel;
    this.activeCancel = undefined;
    cancel?.();
  }

  private next(): void {
    const task = this.tasks.shift();
    if (!task) {
      this.active = false;
      this.onEmpty();
      return;
    }
    this.active = true;
    let settled = false;
    const generation = this.generation;
    this.activeCancel = task.cancel;
    task.run(() => {
      // Guard against a task calling done() more than once, which would advance
      // the queue twice and interleave two animations.
      if (settled || generation !== this.generation) return;
      settled = true;
      this.activeCancel = undefined;
      this.next();
    });
  }
}
