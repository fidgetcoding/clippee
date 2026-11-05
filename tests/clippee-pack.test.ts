import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { Agent } from '../src/character/Agent';
import { DEFAULT_PACK, loadPack } from '../src/character/packLoader';
import type { LoadedPack, Pack } from '../src/character/types';

const dir = resolve(__dirname, '../src/packs/clippee');
const data = JSON.parse(readFileSync(resolve(dir, 'pack.json'), 'utf8')) as Pack;
const png = readFileSync(resolve(dir, 'map.png'));
const sheet = { w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
const pack: LoadedPack = { name: 'clippee', spriteUrl: 'map.png', data };

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('ships every animation the extension plays by name', () => {
  // The names in src/content/index.ts and src/character/Agent.ts, plus Thinking
  // for fix drafts. A missing one fails silently at runtime: he just stands there.
  const played = ['Show', 'Hide', 'RestPose', 'Greeting', 'GetAttention', 'Writing',
    'CheckingSomething', 'Explain', 'Congratulate', 'Thinking'];
  for (const name of played) expect(data.animations[name], name).toBeDefined();
  expect(Object.keys(data.animations).filter((n) => n.startsWith('Idle')).length).toBeGreaterThanOrEqual(8);
  expect(DEFAULT_PACK).toBe('clippee');
});

it('points every frame at a cell inside the sprite sheet', () => {
  const [w, h] = data.framesize;
  for (const [name, animation] of Object.entries(data.animations)) {
    expect(animation.frames.length, name).toBeGreaterThan(0);
    for (const frame of animation.frames) {
      for (const [x, y] of frame.images ?? []) {
        expect(x + w, name).toBeLessThanOrEqual(sheet.w);
        expect(y + h, name).toBeLessThanOrEqual(sheet.h);
      }
      for (const branch of frame.branching?.branches ?? []) {
        expect(branch.frameIndex, name).toBeLessThan(animation.frames.length);
      }
      if (frame.exitBranch !== undefined) expect(frame.exitBranch, name).toBeLessThan(animation.frames.length);
    }
  }
});

it('thinks while fixes are written and stops when they land', async () => {
  vi.useFakeTimers();
  const agent = new Agent(pack);
  let finishDrafts!: () => void;
  const drafts = new Promise<void>((r) => { finishDrafts = r; });
  const done = vi.fn();
  void agent.playUntil('Thinking', drafts).then(done);

  // Thinking loops back on itself with weight 100: on its own it never ends.
  await vi.advanceTimersByTimeAsync(60_000);
  expect(done).not.toHaveBeenCalled();

  finishDrafts();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(done).toHaveBeenCalledTimes(1);
  agent.destroy();
});

it('skips Thinking when the drafts land before its turn', async () => {
  vi.useFakeTimers();
  const agent = new Agent(pack);
  void agent.play('Explain');
  const done = vi.fn();
  void agent.playUntil('Thinking', Promise.resolve()).then(done);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(done).toHaveBeenCalledTimes(1);
  agent.destroy();
});

it('falls back to Clippee when saved settings name a pack that no longer ships', async () => {
  const fetchMock = vi.fn(async (url: string) =>
    url.includes('/clippee/')
      ? new Response(JSON.stringify(data), { status: 200 })
      : new Response('', { status: 404 }));
  vi.stubGlobal('fetch', fetchMock);
  const loaded = await loadPack('clippy');
  expect(loaded.name).toBe('clippee');
  expect(loaded.spriteUrl).toContain('src/packs/clippee/map.png');
});
