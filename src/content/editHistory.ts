import type { DocumentEdit } from '../agent/types';
import { locate, normalize } from '../docs/match';
import type { DocumentSource } from './documentSource';
import type { AgentChange, UndoResult } from './chatTypes';

/** Where a change sits: the text just before and just after it. */
export interface Anchor {
  readonly prefix: string;
  readonly suffix: string;
}

/** What one anchored swap did. `changed`: the text around it moved on, so nothing was touched. */
export type SwapOutcome = 'done' | 'changed' | 'failed';

/** How much text either side of a change identifies where it is. */
const ANCHOR_CHARS = 40;

interface Record_ {
  before: string;
  after: string;
  start: number;
  context: unknown;
  undone: boolean;
}

/** Serializes document mutations and keeps exact snapshots for conservative undo. */
export class EditHistory {
  private tail: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private readonly records = new WeakMap<AgentChange, Record_>();

  constructor(private readonly source: DocumentSource) {}

  dispose(): void { this.disposed = true; }

  private run<T>(action: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(action);
    this.tail = pending.catch(() => undefined);
    return pending;
  }

  apply(edits: readonly DocumentEdit[], context = this.source.context?.()): Promise<AgentChange[]> {
    return this.run(async () => {
      const changes: AgentChange[] = [];
      for (const edit of edits) {
        try {
          if (this.disposed || context !== this.source.context?.()) throw new Error('The active document changed. Reopen the panel.');
          const before = await this.source.read();
          if (before === undefined) throw new Error('Could not read the document.');
          const hit = locate(before, edit.find);
          if ('error' in hit) throw new Error(hit.error === 'ambiguous'
            ? 'That phrase appears more than once.' : 'That passage has changed.');
          if (this.disposed || context !== this.source.context?.()) throw new Error('The active document changed. Reopen the panel.');
          const original = before.slice(hit.start, hit.end);
          const outcome = await this.source.replace(original, edit.replace);
          if (!outcome.applied) throw new Error(outcome.reason === 'unverified'
            ? 'Could not confirm the edit. Check the document before retrying.'
            : 'The page could not apply this change. The passage or selection may have changed.');
          const change: AgentChange = { find: original, replace: edit.replace, applied: true };
          const after = (await this.source.read().catch(() => undefined)) ?? '';
          const expected = before.slice(0, hit.start) + edit.replace + before.slice(hit.end);
          if (context === this.source.context?.() && normalize(after) === normalize(expected)) {
            this.records.set(change, { before, after, start: outcome.start, context, undone: false });
          }
          changes.push(change);
        } catch (error: unknown) {
          changes.push({ ...edit, applied: false, reason: error instanceof Error ? error.message : 'Edit failed.' });
        }
      }
      return changes;
    });
  }

  /**
   * Where an applied change landed, for the History. Only edits that were
   * read back and verified have one.
   */
  anchorOf(change: AgentChange): Anchor | undefined {
    const record = this.records.get(change);
    return record && !record.undone ? anchorIn(record, change) : undefined;
  }

  /**
   * Swap one change back out (`undo`) or back in (`redo`), from the History,
   * long after the receipt that made it is gone. `live` is the change's
   * receipt from this page, kept in step so its own Undo and Redo stay right.
   */
  swap(
    change: Pick<AgentChange, 'find' | 'replace'>,
    anchor: Anchor,
    direction: 'undo' | 'redo',
    live?: AgentChange,
    context = this.source.context?.(),
  ): Promise<SwapOutcome> {
    return this.run(async () => {
      const result = await this.swapNow(change, anchor, direction, context);
      if (result.outcome === 'done' && live) this.records.set(live, result.record);
      return result.outcome;
    });
  }

  /**
   * The careful swap: it runs only where the exact text, with the same words
   * either side, still stands once in the doc. If anything there changed it
   * touches nothing. Call it inside `run`.
   */
  private async swapNow(
    change: Pick<AgentChange, 'find' | 'replace'>,
    anchor: Anchor,
    direction: 'undo' | 'redo',
    context: unknown,
  ): Promise<{ outcome: SwapOutcome; record: Record_ }> {
    const [from, to] = direction === 'undo' ? [change.replace, change.find] : [change.find, change.replace];
    const fail = (outcome: SwapOutcome): { outcome: SwapOutcome; record: Record_ } =>
      ({ outcome, record: { before: '', after: '', start: 0, context, undone: false } });
    if (this.disposed || context !== this.source.context?.()) return fail('failed');
    const current = await this.source.read();
    if (current === undefined) return fail('failed');
    const hit = locate(current, anchor.prefix + from + anchor.suffix);
    if ('error' in hit) return fail('changed');
    const at = hit.start + anchor.prefix.length;
    if (this.disposed || context !== this.source.context?.()) return fail('failed');
    const outcome = await this.source.replace(current.slice(at, at + from.length), to, at);
    if (!outcome.applied) return fail('failed');
    const after = (await this.source.read().catch(() => undefined)) ?? '';
    const expected = current.slice(0, at) + to + current.slice(at + from.length);
    if (normalize(after) !== normalize(expected)) return fail('failed');
    return {
      outcome: 'done',
      record: direction === 'undo'
        ? { before: after, after: current, start: at, context, undone: true }
        : { before: current, after, start: at, context, undone: false },
    };
  }

  async redo(changes: readonly AgentChange[], context = this.source.context?.()): Promise<AgentChange[]> {
    // Already back in (the History put it there): applying again would double it.
    const already = await this.run(async () => {
      const current = await this.source.read().catch(() => undefined);
      return changes.map((change) => {
        const record = this.records.get(change);
        return !!record && !record.undone && current === record.after;
      });
    });
    const pending = changes.filter((_, i) => !already[i]);
    const applied = await this.apply(pending, context);
    let next = 0;
    const results = changes.map((change, i) => (already[i] ? change : applied[next++]!));
    return results.map((result, index) => {
      if (already[index]) return result;
      const original = changes[index];
      const record = this.records.get(result);
      if (!original || !result.applied || !record) return result;
      // A fix has both an individual receipt and a Fix all receipt. Keep their
      // identities shared across redo so either Undo sees the current record.
      this.records.set(original, record);
      return original;
    });
  }

  undo(changes: readonly AgentChange[]): Promise<UndoResult> {
    return this.run(async () => {
      const undone: AgentChange[] = [];
      for (const change of [...changes].reverse()) {
        const record = this.records.get(change);
        if (this.disposed || !record || record.context !== this.source.context?.()) continue;
        try {
          // A near-match is not identity. In particular an empty replacement
          // must never insert deleted prose at an unverified stale offset.
          const current = (await this.source.read()) ?? '';
          if (this.disposed) continue;
          if (record.undone) {
            // Already out (here, or from the History): the original stands where it was.
            const back = anchorIn(record, change);
            if (current === record.before || !('error' in locate(current, back.prefix + change.find + back.suffix))) {
              undone.push(change);
              continue;
            }
            // Put back in some other way (the editor's own Redo): undo it again below.
          }
          if (record.context !== this.source.context?.()) continue;
          if (current === record.after) {
            const outcome = await this.source.replace(change.replace, change.find, record.start);
            if (!outcome.applied || (await this.source.read()) !== record.before) continue;
            record.undone = true;
            undone.push(change);
            continue;
          }
          // The doc moved on elsewhere (a later fix, the user typing in another
          // paragraph). Undo still goes, but only where this change's own text
          // and the words around it are untouched.
          const result = await this.swapNow(change, anchorIn(record, change), 'undo', record.context);
          if (result.outcome !== 'done') continue;
          this.records.set(change, result.record);
          undone.push(change);
        } catch {
          // Keep trying independent receipts and report exactly which succeeded.
        }
      }
      if (undone.length === 0) throw new Error("Couldn't undo safely. The document changed; use its own Undo history.");
      return {
        undone,
        message: undone.length === changes.length ? 'Put it back the way it was.'
          : `Undid ${undone.length} of ${changes.length}. The rest had changed since.`,
      };
    });
  }
}

/** The words either side of a change, from the doc as it was before it went in. */
function anchorIn(record: Pick<Record_, 'before' | 'start'>, change: Pick<AgentChange, 'find'>): Anchor {
  const end = record.start + change.find.length;
  return {
    prefix: record.before.slice(Math.max(0, record.start - ANCHOR_CHARS), record.start),
    suffix: record.before.slice(end, end + ANCHOR_CHARS),
  };
}
