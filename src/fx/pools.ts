import { drawFromBag, isBag, type BagState } from '../character/shuffleBag';
import { ext } from '../platform';
import type { FxKind } from './types';

export { drawFromBag, type BagState };

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

const BAGS_KEY = 'mrclippy:fx-bags';

type Bags = Partial<Record<FxKind, BagState>>;

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
