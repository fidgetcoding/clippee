import type { LoadedPack, Pack } from './types';

/**
 * Character packs are data, not code.
 *
 * The split matters legally as well as architecturally: the engine in this
 * directory is ours, and the artwork in `src/packs/clippy/` is Microsoft's. A
 * public build ships an original pack and lets the user side-load Clippy, which
 * is only cheap if packs were always loaded rather than imported.
 */
export const DEFAULT_PACK = 'clippy';

function assertPack(value: unknown, name: string): asserts value is Pack {
  const pack = value as Partial<Pack> | null;
  if (
    !pack ||
    typeof pack.overlayCount !== 'number' ||
    !Array.isArray(pack.framesize) ||
    pack.framesize.length !== 2 ||
    typeof pack.animations !== 'object' ||
    pack.animations === null
  ) {
    throw new Error(`Character pack "${name}" is malformed`);
  }
}

/** Resolve an extension-relative path to a URL usable from a content script. */
function resourceUrl(path: string): string {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(path);
  }
  return path;
}

export async function loadPack(name: string = DEFAULT_PACK): Promise<LoadedPack> {
  const base = `src/packs/${name}`;
  const response = await fetch(resourceUrl(`${base}/pack.json`));
  if (!response.ok) {
    throw new Error(`Character pack "${name}" not found (${response.status})`);
  }

  const data: unknown = await response.json();
  assertPack(data, name);

  return { name, data, spriteUrl: resourceUrl(`${base}/map.png`) };
}
