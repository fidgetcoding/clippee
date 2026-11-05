import type { LoadedPack, Pack } from './types';

/**
 * Character packs are data, not code.
 *
 * The engine in this directory is clippy.js's, ported; the artwork in
 * `src/packs/clippee/` is original. Anyone can side-load another character,
 * which is only cheap because packs were always loaded rather than imported.
 */
export const DEFAULT_PACK = 'clippee';

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
  try {
    return await fetchPack(name);
  } catch (error) {
    // Settings saved before Clippee had his own art still name 'clippy', which
    // no longer ships. Fall back rather than leave the page without him.
    if (name === DEFAULT_PACK) throw error;
    return fetchPack(DEFAULT_PACK);
  }
}

async function fetchPack(name: string): Promise<LoadedPack> {
  const base = `src/packs/${name}`;
  const response = await fetch(resourceUrl(`${base}/pack.json`));
  if (!response.ok) {
    throw new Error(`Character pack "${name}" not found (${response.status})`);
  }

  const data: unknown = await response.json();
  assertPack(data, name);

  return { name, data, spriteUrl: resourceUrl(`${base}/map.png`) };
}
