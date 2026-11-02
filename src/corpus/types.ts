/**
 * The corpus: everything you have written, as something navigable.
 *
 * This is the capability no incumbent can reach. Every shipped competitor
 * grounds its "second brain" in *work* data — Salesforce, Jira, Confluence,
 * Gmail. None of them can know you argued the opposite in an essay two years
 * ago, because that essay is in your Drive and not in their connector list.
 */

export interface CorpusDoc {
  /** Google Drive file id. */
  readonly id: string;
  readonly title: string;
  /** Folder path, root first: ["Tidewater", "Scripts"]. Empty for My Drive. */
  readonly path: readonly string[];
  /** ISO timestamp of the last edit. */
  readonly modified: string;
  /** Extracted plain text. Absent until the doc has been fetched. */
  readonly text?: string;
  readonly wordCount?: number;
}

/** A retrieved passage, with enough provenance to cite it. */
export interface Passage {
  readonly docId: string;
  readonly title: string;
  readonly path: readonly string[];
  readonly text: string;
  /** Character offset within the source document. */
  readonly offset: number;
}

export interface ScoredPassage extends Passage {
  readonly score: number;
  /** Why this surfaced — shown to the user, and useful when tuning. */
  readonly reasons: readonly string[];
}

export interface RetrievalQuery {
  /** The document currently being written. Excluded from its own results. */
  readonly currentDocId?: string;
  readonly currentPath?: readonly string[];
  /** Free text — usually the user's question, or the paragraph being written. */
  readonly text: string;
  readonly limit?: number;
}

/** Where the corpus lives. An interface so the Drive client can be faked. */
export interface CorpusStore {
  list(): Promise<readonly CorpusDoc[]>;
  get(id: string): Promise<CorpusDoc | undefined>;
  put(doc: CorpusDoc): Promise<void>;
  /** Epoch ms of the last successful sync, or 0. */
  lastSync(): Promise<number>;
  setLastSync(at: number): Promise<void>;
  clear(): Promise<void>;
}

export const INDEX_KEY = 'mrclippy:corpus';
export const SYNC_KEY = 'mrclippy:corpusSync';
