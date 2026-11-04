import { afterEach, expect, it, vi } from 'vitest';
import { Animator } from '../src/character/Animator';
import { Agent } from '../src/character/Agent';
const pack = { name: 'test', spriteUrl: 'map.png', data: {
  overlayCount: 1, framesize: [10, 10] as const, sounds: [],
  animations: { Wave: { frames: [ { duration: 10, images: [[0, 0] as const] }, { duration: 10, images: [[10, 0] as const] } ] } },
} };
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
it('stops scheduling after a non-looping animation reaches its final frame', () => {
  vi.useFakeTimers();
  const el = document.createElement('div');
  const animator = new Animator(el, pack);
  animator.play('Wave');
  vi.advanceTimersByTime(1000);
  expect(vi.getTimerCount()).toBe(0);
  expect(el.style.display).toBe('block');
  animator.stop();
});
it('clears balloon timers when the character is destroyed', async () => {
  vi.useFakeTimers();
  const agent = new Agent(pack);
  agent.show();
  await agent.speak('Hello', 7000);
  agent.destroy();
  expect(vi.getTimerCount()).toBe(0);
});
it('settles running and queued animation promises when hidden', async () => {
  vi.useFakeTimers();
  const agent = new Agent(pack);
  const done = vi.fn();
  void agent.play('Wave').then(done);
  void agent.play('Wave').then(done);
  agent.hide(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(done).toHaveBeenCalledTimes(2);
  agent.destroy();
});
