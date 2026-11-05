import type { DocumentEdit } from '../agent/types';
import type { AgentChange, UndoResult } from './chatTypes';
import { DocHistory, historyKey } from './docHistory';
import type { DocumentSource } from './documentSource';
import { EditHistory } from './editHistory';

/**
 * The one way into the document. Every edit, Undo and Redo goes through here,
 * whether it came from a fix, Fix all, the chat or a receipt, so the History
 * hears about all of them and nothing slips past it.
 */
export class DocEdits {
  readonly history: DocHistory;
  private readonly edits: EditHistory;

  constructor(source: DocumentSource, url = location.href) {
    this.edits = new EditHistory(source);
    this.history = new DocHistory(historyKey(url), this.edits);
  }

  async apply(edits: readonly DocumentEdit[], context: unknown, origin = 'Asked'): Promise<AgentChange[]> {
    const changes = await this.edits.apply(edits, context);
    void this.history.record(changes, origin).catch(() => undefined);
    return changes;
  }

  async undo(changes: readonly AgentChange[]): Promise<UndoResult> {
    const result = await this.edits.undo(changes);
    void this.history.mark(result.undone, 'undone').catch(() => undefined);
    return result;
  }

  async redo(changes: readonly AgentChange[], context: unknown): Promise<AgentChange[]> {
    const results = await this.edits.redo(changes, context);
    results.forEach((result, i) => {
      const original = changes[i];
      if (original && result.applied) this.history.relink(original, result);
    });
    void this.history.mark(results.filter((r) => r.applied), 'applied').catch(() => undefined);
    return results;
  }

  dispose(): void {
    this.edits.dispose();
    this.history.dispose();
  }
}
