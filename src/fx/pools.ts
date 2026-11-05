import { ext } from '../platform';
import type { FxKind } from './types';

/**
 * The entrances and exits Nate starred in the round 2 animation lab. Four of
 * the entrances keep their entry only ("i like the entry, not the exit"), and
 * the rubber band keeps its exit only.
 */
export const APPEAR_POOL: readonly string[] = ['r1', 'r5', 'r4', 'p2', 'p1', 'c1', 'c4', 'x1', 'x2', 'x3', 'x4'];
export const DISAPPEAR_POOL: readonly string[] = ['r1', 'r4', 'p2', 'p4', 'c4', 'x2', 'x3', 'x4'];

export const POOLS: Readonly<Record<FxKind, readonly string[]>> = {
  appear: APPEAR_POOL,
  disappear: DISAPPEAR_POOL,
};

/** What is left in one bag, and what came out last. */
export interface BagState {
  readonly bag: readonly string[];
  readonly last?: string;
}

/**
 * Take the next effect from a shuffle bag. Every effect in the pool plays once
 * before any repeats, and a fresh bag never starts with the one that ended the
 * last, so he never does the same thing twice in a row.
 */
export function drawFromBag(
  state: BagState | undefined,
  pool: readonly string[],
  random: () => number = Math.random,
): { id: string; state: BagState } {
  const seen = new Set<string>();
  let bag = (state?.bag ?? []).filter((id) => pool.includes(id) && !seen.has(id) && seen.add(id));
  if (bag.length === 0) {
    bag = shuffle(pool, random);
    if (bag.length > 1 && bag[0] === state?.last) {
      const j = 1 + Math.floor(random() * (bag.length - 1));
      [bag[0], bag[j]] = [bag[j]!, bag[0]!];
    }
  }
  const [id, ...rest] = bag;
  if (id === undefined) throw new Error('Empty effect pool.');
  return { id, state: { bag: rest, last: id } };
}

function shuffle(pool: readonly string[], random: () => number): string[] {
  const out = [...pool];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const BAGS_KEY = 'mrclippy:fx-bags';

type Bags = Partial<Record<FxKind, BagState>>;

function isBag(value: unknown): value is BagState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.bag) && v.bag.every((id) => typeof id === 'string') &&
    (v.last === undefined || typeof v.last === 'string');
}

/**
 * The two bags, kept in storage.local so the variety carries across tabs and
 * reloads. Appear and disappear draw independently. Storage failing never
 * stops him: the bag then lives for this page only.
 */
export class FxDeck {
  private pending: Promise<unknown> = Promise.resolve();
  private local: Bags = {};

  constructor(private readonly random: () => number = Math.random) {}

  next(kind: FxKind): Promise<string> {
    const turn = this.pending.then(() => this.draw(kind));
    this.pending = turn.catch(() => undefined);
    return turn;
  }

  private async draw(kind: FxKind): Promise<string> {
    let bags = this.local;
    try {
      const stored = (await ext.storage.local.get(BAGS_KEY))[BAGS_KEY] as Record<string, unknown> | undefined;
      if (stored && typeof stored === 'object') {
        bags = {};
        for (const k of ['appear', 'disappear'] as const) {
          if (isBag(stored[k])) bags[k] = stored[k];
        }
      }
    } catch {
      // Keep the in-page bags.
    }
    const { id, state } = drawFromBag(bags[kind], POOLS[kind], this.random);
    this.local = { ...bags, [kind]: state };
    try {
      await ext.storage.local.set({ [BAGS_KEY]: this.local });
    } catch {
      // Same: the in-page bags still rotate.
    }
    return id;
  }
}
