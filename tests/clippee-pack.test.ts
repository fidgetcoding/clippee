import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterEach, expect, it, vi } from 'vitest';
import { Agent } from '../src/character/Agent';
import { DEFAULT_PACK, loadPack } from '../src/character/packLoader';
import type { LoadedPack, Pack } from '../src/character/types';
import { GREETING_WAVE_FRAME } from '../src/content/presence';

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
    'CheckingSomething', 'Explain', 'Congratulate', 'Thinking', 'Victory'];
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

/**
 * The sheet as RGBA. It is an 8-bit palette PNG (the exporter writes one when
 * the art fits 255 colours), so this is the whole decoder that format needs.
 */
function decodeSheet(file: Buffer): { w: number; rgba: Uint8Array } {
  let at = 8;
  let w = 0, h = 0;
  let palette: Uint8Array = new Uint8Array(0), alpha: Uint8Array = new Uint8Array(0);
  const idat: Buffer[] = [];
  while (at < file.length) {
    const len = file.readUInt32BE(at), type = file.toString('latin1', at + 4, at + 8), body = file.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0); h = body.readUInt32BE(4);
      expect([body[8], body[9]]).toEqual([8, 3]);
    }
    if (type === 'PLTE') palette = body;
    if (type === 'tRNS') alpha = body;
    if (type === 'IDAT') idat.push(body);
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (w + 1)]!, row = raw.subarray(y * (w + 1) + 1, (y + 1) * (w + 1));
    for (let x = 0; x < w; x++) {
      const a = x > 0 ? px[y * w + x - 1]! : 0, b = y > 0 ? px[(y - 1) * w + x]! : 0, c = x > 0 && y > 0 ? px[(y - 1) * w + x - 1]! : 0;
      const pred = filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1
        : filter === 4 ? (Math.abs(b - c) <= Math.abs(a - c) && Math.abs(b - c) <= Math.abs(a + b - 2 * c) ? (Math.abs(a - c) <= Math.abs(a + b - 2 * c) ? a : b) : c) : 0;
      px[y * w + x] = (row[x]! + pred) & 255;
    }
  }
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < px.length; i++) {
    const k = px[i]!, o = k < alpha.length ? alpha[k]! : 255;
    if (o === 0) continue;
    rgba.set([palette[k * 3]!, palette[k * 3 + 1]!, palette[k * 3 + 2]!, o], i * 4);
  }
  return { w, rgba };
}

/** One animation's frames, pixel for pixel, as a short hash. */
let decoded: ReturnType<typeof decodeSheet> | undefined;
function fingerprint(name: string): string {
  decoded ??= decodeSheet(png);
  const { w: sw, rgba } = decoded;
  const [fw, fh] = data.framesize;
  const hash = createHash('sha256');
  for (const frame of data.animations[name]!.frames) {
    const cell = frame.images?.[0];
    if (!cell) { hash.update('blank'); continue; }
    for (let y = cell[1]; y < cell[1] + fh; y++) hash.update(rgba.subarray((y * sw + cell[0]) * 4, (y * sw + cell[0] + fw) * 4));
  }
  return hash.digest('hex').slice(0, 16);
}

it('carries the round 2 jumps: the hopping Congratulate and Greeting, Victory and the waddle', () => {
  // Hashes of the j family's own export (anim-r2/d/j/pack). Each check fails if
  // a different drawing of that animation ships.
  expect(fingerprint('Congratulate')).toBe('9f98f99aa72e9763');
  expect(fingerprint('Greeting')).toBe('1ff4ea3ed0119334');
  expect(fingerprint('Victory')).toBe('45524ba99da96657');
  expect(fingerprint('IdleWaddle')).toBe('f66f6552cec63e10');
  expect(data.framesize).toEqual([124, 93]);
});

it('greets from the wave after an entrance, where he is already drawn in', () => {
  const frames = data.animations.Greeting!.frames;
  expect(frames[0]!.images).toBeUndefined(); // the plain Greeting starts from nothing
  expect(frames[GREETING_WAVE_FRAME]!.images).toBeDefined();
});

it('lets the waddle join the idles', () => {
  const agent = new Agent(pack);
  expect(agent.animations().filter((n) => n.startsWith('Idle'))).toContain('IdleWaddle');
  agent.destroy();
});
