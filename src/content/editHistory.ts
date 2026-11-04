import type { DocumentEdit } from '../agent/types';
import { locate, normalize } from '../docs/match';
import type { DocumentSource } from './documentSource';
import type { AgentChange, UndoResult } from './chatTypes';

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

  async redo(changes: readonly AgentChange[], context = this.source.context?.()): Promise<AgentChange[]> {
    const results = await this.apply(changes, context);
    return results.map((result, index) => {
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
          if (record.undone && current === record.before) { undone.push(change); continue; }
          if (record.context !== this.source.context?.() || current !== record.after) continue;
          const outcome = await this.source.replace(change.replace, change.find, record.start);
          if (!outcome.applied || (await this.source.read()) !== record.before) continue;
          record.undone = true;
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
