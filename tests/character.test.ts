import { describe, expect, it, vi } from 'vitest';
import { Animator } from '../src/character/Animator';
import { IdleScheduler } from '../src/character/IdleScheduler';
import { Queue } from '../src/character/Queue';
import type { LoadedPack } from '../src/character/types';

function pack(animations: LoadedPack['data']['animations']): LoadedPack {
  return {
    name: 'test',
    spriteUrl: 'map.png',
    data: { overlayCount: 1, framesize: [124, 93], sounds: [], animations },
  };
}

describe('Animator frame branching', () => {
  it('takes the exit branch when winding down', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    // Note the shape: in a `useExitBranching` animation the FINAL frame is a
    // sentinel that is never drawn — it is the holding state the animator reports
    // WAITING on. Real packs therefore point `exitBranch` at a mid-animation
    // frame, never at the last index. Authoring a pack the other way produces an
    // animation that silently freezes on whatever frame it was already showing.
    const a = new Animator(
      el,
      pack({
        Idle: {
          useExitBranching: true,
          frames: [
            { duration: 10, images: [[0, 0]] },
            { duration: 10, images: [[124, 0]], exitBranch: 3 },
            { duration: 10, images: [[248, 0]] },
            { duration: 10, images: [[372, 0]] },
            { duration: 10, images: [[496, 0]] },
          ],
        },
      }),
    );

    a.play('Idle');
    vi.advanceTimersByTime(15); // land on frame 1, which carries exitBranch
    expect(el.style.backgroundPosition).toBe('-124px 0px');

    a.exit();
    vi.advanceTimersByTime(10); // should jump to frame 3, not advance to 2

    expect(el.style.backgroundPosition).toBe('-372px 0px');
    a.stop();
    vi.useRealTimers();
  });

  it('resolves weighted branches against a single roll', () => {
    vi.useFakeTimers();
    // 0.9 * 100 = 90. First branch weighs 20 (90 > 20, subtract → 70), second
    // weighs 80 (70 <= 80) so the second branch wins.
    vi.spyOn(Math, 'random').mockReturnValue(0.9);

    const el = document.createElement('div');
    const a = new Animator(
      el,
      pack({
        Idle: {
          frames: [
            {
              duration: 10,
              images: [[0, 0]],
              branching: {
                branches: [
                  { weight: 20, frameIndex: 1 },
                  { weight: 80, frameIndex: 2 },
                ],
              },
            },
            { duration: 10, images: [[124, 0]] },
            { duration: 10, images: [[248, 0]] },
          ],
        },
      }),
    );

    a.play('Idle');
    vi.advanceTimersByTime(15);

    expect(el.style.backgroundPosition).toBe('-248px 0px');
    a.stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('refuses an unknown or empty animation instead of throwing', () => {
    const el = document.createElement('div');
    const a = new Animator(el, pack({ Empty: { frames: [] } }));

    expect(a.play('DoesNotExist')).toBe(false);
    expect(a.play('Empty')).toBe(false);
  });
});

describe('IdleScheduler cadence', () => {
  it('never schedules on a fixed beat', () => {
    // Live2D's model: nominal 4s interval, next event uniform across [0, 2i - 1s).
    // A predictable loop reads as a GIF.
    const rolls = [0, 0.5, 0.999];
    let i = 0;
    const s = new IdleScheduler(['IdleAtom'], () => {}, {
      intervalMs: 4_000,
      random: () => rolls[i++ % rolls.length] ?? 0,
    });

    expect(s.nextDelayMs()).toBe(0);
    expect(s.nextDelayMs()).toBe(3_500);
    expect(s.nextDelayMs()).toBeCloseTo(6_993, 0);
  });

  it('avoids playing the same idle twice in a row', () => {
    const s = new IdleScheduler(['A', 'B'], () => {}, { random: () => 0 });
    const picks = Array.from({ length: 10 }, () => s.pick());
    for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1]);
  });

  it('repeats when only one idle exists rather than returning nothing', () => {
    const s = new IdleScheduler(['Only'], () => {}, { random: () => 0 });
    expect(s.pick()).toBe('Only');
    expect(s.pick()).toBe('Only');
  });
});

describe('Queue', () => {
  it('reset() drops a stuck running task, and its late done() is ignored', () => {
    const queue = new Queue(() => {});
    let staleDone: (() => void) | undefined;
    queue.push((done) => (staleDone = done));
    const second = vi.fn();
    queue.push(second);
    queue.reset();
    expect(queue.busy).toBe(false);
    const fresh = vi.fn();
    queue.push(fresh);
    expect(fresh).toHaveBeenCalledTimes(1);
    const after = vi.fn();
    queue.push(after);
    staleDone?.();
    expect(after).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it('ignores a second done() so animations cannot interleave', () => {
    const order: string[] = [];
    const q = new Queue(() => order.push('empty'));

    // The first task completes asynchronously, so the second is already queued
    // when it finishes — which is the situation a real animation is always in.
    let releaseFirst: (() => void) | undefined;
    q.push((done) => {
      order.push('first');
      releaseFirst = done;
    });
    q.push((done) => {
      order.push('second');
      done();
    });

    expect(order).toEqual(['first']);

    releaseFirst?.();
    releaseFirst?.(); // a double completion must not advance the queue twice

    expect(order).toEqual(['first', 'second', 'empty']);
  });

  it('signals empty so the idle scheduler can take over', () => {
    const onEmpty = vi.fn();
    const q = new Queue(onEmpty);
    q.push((done) => done());

    expect(onEmpty).toHaveBeenCalledTimes(1);
  });
});
