import { expect, it, vi } from 'vitest';
import { DraftCache } from '../src/content/draftCache';
it('deduplicates drafts and evicts old questions and document revisions', async () => {
  const cache = new DraftCache<string>(2);
  const build = vi.fn(async () => 'draft');
  await Promise.all([cache.get('doc', true, 'q1', build), cache.get('doc', true, 'q1', build)]);
  expect(build).toHaveBeenCalledTimes(1);
  await cache.get('doc', true, 'q2', build);
  await cache.get('doc', true, 'q3', build);
  await cache.get('doc', true, 'q1', build);
  expect(build).toHaveBeenCalledTimes(4);
  await cache.get('new doc', true, 'q1', build);
  await cache.get('doc', true, 'q1', build);
  expect(build).toHaveBeenCalledTimes(6);
});

it('allows retry after failure without evicting a newer snapshot request', async () => {
  const cache = new DraftCache<string>();
  let reject!: (error: Error) => void;
  const first = cache.get('old', true, 'q', () => new Promise((_resolve, r) => { reject = r; }));
  await Promise.resolve();
  const fresh = cache.get('new', true, 'q', async () => 'fresh');
  reject(new Error('offline'));
  await expect(first).rejects.toThrow('offline');
  await fresh;
  const unexpected = vi.fn(async () => 'wrong');
  expect(await cache.get('new', true, 'q', unexpected)).toBe('fresh');
  expect(unexpected).not.toHaveBeenCalled();
  const failing = () => Promise.reject(new Error('retry'));
  await expect(cache.get('new', true, 'retry', failing)).rejects.toThrow('retry');
  expect(await cache.get('new', true, 'retry', async () => 'works')).toBe('works');
});
