import { ext } from '../platform';
import type { AgentChange } from './chatTypes';
import type { Anchor, EditHistory, SwapOutcome } from './editHistory';

/**
 * Every change he has made to one document, kept so it can be undone later:
 * after the panel closes, after a reload, after the fix's receipt is long gone.
 *
 * Stored per document in storage.local, on this computer only. Each entry
 * keeps the text it replaced, the text it wrote and a few words either side
 * to find it again; nothing is synced or sent anywhere.
 */

export const HISTORY_PREFIX = 'mrclippy:history:';
/** Whichever comes first. */
export const HISTORY_MAX_ENTRIES = 200;
export const HISTORY_MAX_AGE_MS = 30 * 24 * 60 * 60_000;

export interface HistoryEntry {
  readonly id: string;
  /** Changes made by one Apply share a batch, so "undo the last fix" takes all of it. */
  readonly batch: string;
  /** When it was applied. */
  readonly at: number;
  /** Where it came from: the fix's title, "Fix all", or "Asked: …". */
  readonly origin: string;
  readonly find: string;
  readonly replace: string;
  /** Missing when the edit couldn't be read back, so it can't be found again safely. */
  readonly anchor?: Anchor;
  readonly state: 'applied' | 'undone';
}

export type HistoryOutcome = SwapOutcome | 'missing';

/** The History as the panel sees it. Undo and Redo resolve to one outcome per id. */
export interface HistoryApi {
  /** Newest first. */
  list(): Promise<readonly HistoryEntry[]>;
  undo(ids: readonly string[]): Promise<ReadonlyMap<string, HistoryOutcome>>;
  redo(ids: readonly string[]): Promise<ReadonlyMap<string, HistoryOutcome>>;
  clear(): Promise<void>;
  /** Called when the History changes, here or in another tab on the same doc. */
  subscribe(listener: () => void): () => void;
}

/** One document's key: its Docs id, so every URL for the doc shares one History. */
export function historyKey(url: string): string {
  const parsed = new URL(url);
  const docs = /\/document\/d\/([\w-]+)/.exec(parsed.pathname);
  if (parsed.hostname === 'docs.google.com' && docs) return `${HISTORY_PREFIX}docs:${docs[1]}`;
  return `${HISTORY_PREFIX}${parsed.hostname}${parsed.pathname}`;
}

function isEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const str = (x: unknown): x is string => typeof x === 'string';
  const anchor = v.anchor as Record<string, unknown> | undefined;
  return str(v.id) && str(v.batch) && typeof v.at === 'number' && str(v.origin) && str(v.find) &&
    str(v.replace) && (v.state === 'applied' || v.state === 'undone') &&
    (anchor === undefined || (typeof anchor === 'object' && anchor !== null && str(anchor.prefix) && str(anchor.suffix)));
}

/** Newest first, nothing older than the cap, no more than the cap. */
export function trim(entries: readonly HistoryEntry[], now = Date.now()): HistoryEntry[] {
  return [...entries]
    .filter((e) => now - e.at <= HISTORY_MAX_AGE_MS)
    .sort((a, b) => b.at - a.at)
    .slice(0, HISTORY_MAX_ENTRIES);
}

const newId = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export class DocHistory implements HistoryApi {
  /** This page's receipts, so an Undo from the History keeps them in step. */
  private readonly live = new Map<string, AgentChange>();
  private readonly ids = new WeakMap<AgentChange, string>();
  private readonly listeners = new Set<() => void>();
  private tail: Promise<unknown> = Promise.resolve();
  private readonly onStorage = (changes: Record<string, unknown>, area: string): void => {
    if (area === 'local' && this.key in changes) this.emit();
  };

  constructor(
    private readonly key: string,
    private readonly edits: Pick<EditHistory, 'anchorOf' | 'swap'>,
    private readonly now: () => number = Date.now,
  ) {}

  dispose(): void {
    if (this.listeners.size > 0) ext.storage?.onChanged?.removeListener(this.onStorage);
    this.listeners.clear();
  }

  /** Called right after an Apply, from the one place every edit goes through. */
  record(changes: readonly AgentChange[], origin: string): Promise<void> {
    const landed = changes.filter((c) => c.applied);
    if (landed.length === 0) return Promise.resolve();
    const batch = newId();
    const at = this.now();
    const fresh = landed.map((change): HistoryEntry => {
      const id = newId();
      this.live.set(id, change);
      this.ids.set(change, id);
      const anchor = this.edits.anchorOf(change);
      return { id, batch, at, origin, find: change.find, replace: change.replace, ...(anchor ? { anchor } : {}), state: 'applied' };
    });
    return this.update((entries) => [...fresh.reverse(), ...entries]);
  }

  /** A receipt's own Undo or Redo went through. */
  mark(changes: readonly AgentChange[], state: HistoryEntry['state']): Promise<void> {
    const ids = new Set(changes.flatMap((c) => this.ids.get(c) ?? []));
    if (ids.size === 0) return Promise.resolve();
    return this.update((entries) => entries.map((e) => (ids.has(e.id) ? { ...e, state } : e)));
  }

  /** A receipt's Redo can hand back a new change object: it is the same entry. */
  relink(from: AgentChange, to: AgentChange): void {
    const id = this.ids.get(from);
    if (id === undefined || from === to) return;
    this.ids.set(to, id);
    this.live.set(id, to);
  }

  /** This page's change objects for some entries, for their receipts to follow a History swap. */
  liveChanges(ids: readonly string[]): AgentChange[] {
    return ids.flatMap((id) => this.live.get(id) ?? []);
  }

  list(): Promise<readonly HistoryEntry[]> {
    return this.read();
  }

  undo(ids: readonly string[]): Promise<ReadonlyMap<string, HistoryOutcome>> {
    return this.swapAll(ids, 'undo');
  }

  redo(ids: readonly string[]): Promise<ReadonlyMap<string, HistoryOutcome>> {
    return this.swapAll(ids, 'redo');
  }

  clear(): Promise<void> {
    return this.queue(async () => {
      await ext.storage.local.remove(this.key);
      this.emit();
    });
  }

  /** Storage is only watched while someone is looking: the History screen. */
  subscribe(listener: () => void): () => void {
    if (this.listeners.size === 0) ext.storage?.onChanged?.addListener(this.onStorage);
    this.listeners.add(listener);
    return () => {
      if (this.listeners.delete(listener) && this.listeners.size === 0) {
        ext.storage?.onChanged?.removeListener(this.onStorage);
      }
    };
  }

  /**
   * Undo runs newest first and Redo oldest first, so changes that sit close
   * together come out and go back in the order they went in.
   */
  private async swapAll(ids: readonly string[], direction: 'undo' | 'redo'): Promise<ReadonlyMap<string, HistoryOutcome>> {
    const outcomes = new Map<string, HistoryOutcome>();
    const entries = await this.read();
    const wanted = entries.filter((e) => ids.includes(e.id) && e.state === (direction === 'undo' ? 'applied' : 'undone'));
    const order = direction === 'undo' ? wanted : [...wanted].reverse();
    for (const id of ids) if (!wanted.some((e) => e.id === id)) outcomes.set(id, 'missing');
    const flipped = new Set<string>();
    for (const entry of order) {
      const outcome = entry.anchor
        ? await this.edits.swap(entry, entry.anchor, direction, this.live.get(entry.id))
        : 'changed';
      outcomes.set(entry.id, outcome);
      if (outcome === 'done') flipped.add(entry.id);
    }
    if (flipped.size > 0) {
      const state = direction === 'undo' ? 'undone' : 'applied';
      await this.update((all) => all.map((e) => (flipped.has(e.id) ? { ...e, state } : e)));
    }
    return outcomes;
  }

  private async read(): Promise<HistoryEntry[]> {
    try {
      const stored = (await ext.storage.local.get(this.key))[this.key] as { entries?: unknown } | undefined;
      const entries = Array.isArray(stored?.entries) ? stored.entries.filter(isEntry) : [];
      return trim(entries, this.now());
    } catch {
      return [];
    }
  }

  /** Read, change, write, one at a time, so two quick edits never drop each other. */
  private update(change: (entries: HistoryEntry[]) => HistoryEntry[]): Promise<void> {
    return this.queue(async () => {
      const next = trim(change(await this.read()), this.now());
      try {
        await ext.storage.local.set({ [this.key]: { v: 1, entries: next } });
      } catch {
        // Storage full or gone: the edit itself already happened.
      }
      this.emit();
    });
  }

  private queue(task: () => Promise<void>): Promise<void> {
    const run = this.tail.then(task);
    this.tail = run.catch(() => undefined);
    return run;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
