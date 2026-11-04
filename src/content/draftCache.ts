/** Drafts for the current document snapshot only, bounded by question count. */
export class DraftCache<T> {
  private document: string | undefined;
  private editable = false;
  private readonly entries = new Map<string, Promise<T>>();

  constructor(private readonly limit = 24) {}

  get(document: string, editable: boolean, question: string, build: () => Promise<T>): Promise<T> {
    if (document !== this.document || editable !== this.editable) {
      this.clear();
      this.document = document;
      this.editable = editable;
    }
    const existing = this.entries.get(question);
    if (existing) {
      this.entries.delete(question);
      this.entries.set(question, existing);
      return existing;
    }
    const pending = Promise.resolve().then(build);
    this.entries.set(question, pending);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    void pending.catch(() => {
      // An evicted request can fail after a newer snapshot reused the question.
      if (this.entries.get(question) === pending) this.entries.delete(question);
    });
    return pending;
  }

  clear(): void {
    this.document = undefined;
    this.entries.clear();
  }
}
