/** A unit of work that signals its own completion. */
export type QueuedTask = (done: () => void) => void;

/**
 * Serialises character actions so animations never overlap.
 *
 * Ported from clippy.js `src/queue.js` (MIT), with an empty-queue callback so the
 * idle scheduler can take over the moment Mr. Clippy has nothing else to do.
 */
export class Queue {
  private readonly tasks: QueuedTask[] = [];
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

  push(task: QueuedTask): void {
    this.tasks.push(task);
    if (!this.active) this.next();
  }

  /** Drop everything not yet started. Does not interrupt the running task. */
  clear(): void {
    this.tasks.length = 0;
  }

  /**
   * Drop everything, including the running task. Its late `done()` is ignored.
   * For when the user wants him gone now, not after the current animation.
   */
  reset(): void {
    this.tasks.length = 0;
    this.generation += 1;
    this.active = false;
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
    task(() => {
      // Guard against a task calling done() more than once, which would advance
      // the queue twice and interleave two animations.
      if (settled || generation !== this.generation) return;
      settled = true;
      this.next();
    });
  }
}
