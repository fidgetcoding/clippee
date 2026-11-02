import { ext } from '../platform';
import { authorize, getStoredToken } from './auth';
import { exportText, listDocs } from './drive';
import { buildIdf, rank } from './rank';
import { INDEX_KEY, SYNC_KEY, type CorpusDoc, type RetrievalQuery, type ScoredPassage } from './types';

/**
 * The indexed corpus.
 *
 * Held in `chrome.storage.local`, which is unlimited with the `unlimitedStorage`
 * permission and survives the service worker being killed — the worker dies at
 * 30 seconds idle, so nothing about a corpus can live in memory.
 *
 * Text is stored, not embeddings. That is a deliberate first step: lexical
 * retrieval over stored text needs no model download, works offline, and gets
 * the signals that actually matter here — shared rare terms, folder proximity,
 * recency. Embeddings slot in behind the same `search()` call when the extra
 * recall earns the 23 MB.
 */

export interface SyncProgress {
  readonly phase: 'listing' | 'fetching' | 'done';
  readonly done: number;
  readonly total: number;
  readonly title?: string;
}

export type ProgressListener = (progress: SyncProgress) => void;

/** Skip docs that changed nothing — a re-sync should be cheap. */
async function loadIndex(): Promise<Map<string, CorpusDoc>> {
  const stored = await ext.storage.local.get(INDEX_KEY);
  const docs = (stored[INDEX_KEY] ?? []) as CorpusDoc[];
  return new Map(docs.map((doc) => [doc.id, doc]));
}

async function saveIndex(index: Map<string, CorpusDoc>): Promise<void> {
  await ext.storage.local.set({ [INDEX_KEY]: [...index.values()] });
}

export async function lastSync(): Promise<number> {
  const stored = await ext.storage.local.get(SYNC_KEY);
  return (stored[SYNC_KEY] ?? 0) as number;
}

export async function corpusSize(): Promise<number> {
  return (await loadIndex()).size;
}

export async function clearCorpus(): Promise<void> {
  await ext.storage.local.remove([INDEX_KEY, SYNC_KEY]);
}

/**
 * Pull Drive into the index.
 *
 * Incremental by modification time: a document whose `modifiedTime` is unchanged
 * keeps its stored text and costs no request. A first run over a few hundred
 * documents is minutes; a re-sync is seconds.
 */
export async function sync(
  clientId: string,
  onProgress?: ProgressListener,
  maxDocs = 500,
): Promise<{ indexed: number; fetched: number }> {
  const token = (await getStoredToken()) ?? (await authorize(clientId));

  onProgress?.({ phase: 'listing', done: 0, total: 0 });
  const listed = await listDocs(token, maxDocs);

  const index = await loadIndex();
  let fetched = 0;

  for (const [i, doc] of listed.entries()) {
    const existing = index.get(doc.id);
    onProgress?.({ phase: 'fetching', done: i, total: listed.length, title: doc.title });

    if (existing?.text !== undefined && existing.modified === doc.modified) {
      // Metadata may still have moved even when the body did not.
      index.set(doc.id, { ...existing, title: doc.title, path: doc.path });
      continue;
    }

    const text = await exportText(token, doc.id);
    fetched++;
    index.set(doc.id, {
      ...doc,
      text,
      wordCount: text.split(/\s+/).filter(Boolean).length,
    });

    // Persist as we go: a worker killed mid-sync should not lose everything.
    if (fetched % 20 === 0) await saveIndex(index);
  }

  // Drop anything that has left Drive.
  const live = new Set(listed.map((d) => d.id));
  for (const id of [...index.keys()]) if (!live.has(id)) index.delete(id);

  await saveIndex(index);
  await ext.storage.local.set({ [SYNC_KEY]: Date.now() });

  onProgress?.({ phase: 'done', done: listed.length, total: listed.length });
  return { indexed: index.size, fetched };
}

/** Find passages from elsewhere in the corpus that bear on this query. */
export async function search(query: RetrievalQuery): Promise<ScoredPassage[]> {
  const index = await loadIndex();
  const docs = [...index.values()];
  if (docs.length === 0) return [];
  return rank(docs, query, { idf: buildIdf(docs) });
}

/** Documents in the same folder, for "what else lives here". */
export async function siblings(path: readonly string[], excludeId?: string): Promise<CorpusDoc[]> {
  const index = await loadIndex();
  return [...index.values()]
    .filter((doc) => doc.id !== excludeId && doc.path.join('/') === path.join('/'))
    .sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified));
}
