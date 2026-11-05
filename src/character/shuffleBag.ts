/**
 * The no-repeat rule, for everything he picks at random: every option plays
 * once before any repeats, and a fresh bag never opens with the one that
 * closed the last, so he never does the same thing twice in a row.
 *
 * No extension APIs in here. Whoever keeps the bag between pages hands in a
 * store; without one the bag lives for the page.
 */

/** What is left in one bag, and what came out last. */
export interface BagState {
  readonly bag: readonly string[];
  readonly last?: string;
}

/** Where a bag's place is kept between pages and tabs. */
export interface BagStore {
  load(): Promise<BagState | undefined>;
  save(state: BagState): void;
}

export function isBag(value: unknown): value is BagState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.bag) && v.bag.every((id) => typeof id === 'string') &&
    (v.last === undefined || typeof v.last === 'string');
}

/** Take the next one from a bag, refilling it when it runs out. */
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
  if (id === undefined) throw new Error('Empty pool.');
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

/**
 * A bag that answers at once. Its saved place arrives from the store a moment
 * after it is made; until then, or if the store has nothing, it starts fresh.
 */
export class ShuffleBag {
  private state: BagState | undefined;
  private drawn = false;

  constructor(
    private readonly pool: readonly string[],
    private readonly store?: BagStore,
    private readonly random: () => number = Math.random,
  ) {
    void store?.load().then((saved) => {
      if (!this.drawn && saved) this.state = saved;
    }).catch(() => undefined);
  }

  next(): string | undefined {
    if (this.pool.length === 0) return undefined;
    const { id, state } = drawFromBag(this.state, this.pool, this.random);
    this.drawn = true;
    this.state = state;
    this.store?.save(state);
    return id;
  }
}
