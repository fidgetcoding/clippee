import type { CorpusDoc, Passage, RetrievalQuery, ScoredPassage } from './types';

/**
 * Retrieval, without a model.
 *
 * Deliberately lexical and structural for now. A 23 MB embedding model
 * downloading on first use is a real cost, and the honest finding is that most
 * of the felt value here — "you wrote about this in X", "this contradicts the
 * one in the same folder" — comes from signals that need no model at all:
 * shared rare terms, folder proximity, and recency.
 *
 * The scorer is a sum of independent signals rather than one metric, so each can
 * be tuned and each can explain itself. `reasons` is not decoration — a
 * retrieval the user cannot account for reads as a hallucination.
 */

/** Words too common to carry signal. Kept short on purpose. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this',
  'these', 'those', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'to',
  'of', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'as', 'it', 'its',
  'he', 'she', 'they', 'them', 'his', 'her', 'their', 'i', 'you', 'we', 'not',
  'no', 'so', 'up', 'out', 'down', 'over', 'into', 'about', 'all', 'one',
  'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could',
]);

export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]{2,}/gu) ?? []).filter(
    (t) => !STOPWORDS.has(t),
  );
}

/**
 * Inverse document frequency over the corpus.
 *
 * The point of weighting by rarity: a shared mention of "Marisol" means the two
 * documents are about the same thing. A shared mention of "document" means
 * nothing. Without IDF, long documents win every query by sheer surface area.
 */
export function buildIdf(docs: readonly CorpusDoc[]): Map<string, number> {
  const seen = new Map<string, number>();
  let counted = 0;

  for (const doc of docs) {
    if (!doc.text) continue;
    counted++;
    for (const term of new Set(terms(doc.text))) {
      seen.set(term, (seen.get(term) ?? 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  for (const [term, count] of seen) {
    idf.set(term, Math.log((counted + 1) / (count + 0.5)));
  }
  return idf;
}

/** Below this a block is a fragment, not a passage. */
const MIN_PASSAGE_CHARS = 80;

/**
 * Split a document into passages worth retrieving.
 *
 * A document shorter than one passage still yields one. Dropping it would make
 * short notes invisible to the corpus, and a one-line note is often the most
 * pointed thing someone has written — exactly the sort of thing worth being
 * reminded of.
 */
export function toPassages(doc: CorpusDoc, targetChars = 900): Passage[] {
  if (!doc.text) return [];

  const blocks = doc.text.split(/\n{2,}/);
  const passages: Passage[] = [];

  let buffer = '';
  let offset = 0;
  let bufferStart = 0;

  const flush = (): void => {
    const trimmed = buffer.trim();
    if (trimmed.length >= MIN_PASSAGE_CHARS) {
      passages.push({
        docId: doc.id,
        title: doc.title,
        path: doc.path,
        text: trimmed,
        offset: bufferStart,
      });
    }
    buffer = '';
  };

  for (const block of blocks) {
    if (buffer.length === 0) bufferStart = offset;
    buffer += (buffer.length > 0 ? '\n\n' : '') + block;
    offset += block.length + 2;
    if (buffer.length >= targetChars) flush();
  }
  flush();

  // Nothing cleared the floor, but the document is not empty: keep it whole.
  if (passages.length === 0) {
    const whole = doc.text.trim();
    if (whole.length > 0) {
      passages.push({ docId: doc.id, title: doc.title, path: doc.path, text: whole, offset: 0 });
    }
  }

  return passages;
}

/** How much two folder paths have in common, 0-1. */
export function pathAffinity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared++;
  return shared / Math.max(a.length, b.length);
}

/** Newer writing is likelier to be what you mean. Half-life of 180 days. */
export function recencyBoost(modified: string, now = Date.now()): number {
  const age = now - Date.parse(modified);
  if (!Number.isFinite(age) || age < 0) return 1;
  return 2 ** (-age / (180 * 24 * 60 * 60_000));
}

export interface RankOptions {
  readonly idf: Map<string, number>;
  readonly now?: number;
}

/**
 * Score every passage against the query and return the best.
 *
 * Signals, in order of weight: shared rare terms, folder proximity, recency.
 * The current document is always excluded — telling someone their document
 * resembles itself is not insight.
 */
export function rank(
  docs: readonly CorpusDoc[],
  query: RetrievalQuery,
  options: RankOptions,
): ScoredPassage[] {
  const queryTerms = new Set(terms(query.text));
  if (queryTerms.size === 0) return [];

  const now = options.now ?? Date.now();
  const scored: ScoredPassage[] = [];

  for (const doc of docs) {
    if (doc.id === query.currentDocId) continue;

    const affinity = query.currentPath ? pathAffinity(query.currentPath, doc.path) : 0;
    const recency = recencyBoost(doc.modified, now);

    for (const passage of toPassages(doc)) {
      const passageTerms = terms(passage.text);
      if (passageTerms.length === 0) continue;

      const overlap = new Set<string>();
      let lexical = 0;
      for (const term of passageTerms) {
        if (!queryTerms.has(term) || overlap.has(term)) continue;
        overlap.add(term);
        lexical += options.idf.get(term) ?? 1;
      }
      if (overlap.size === 0) continue;

      // Normalise by passage length so a long block does not win on volume.
      const density = lexical / Math.sqrt(passageTerms.length);
      const score = density * (1 + affinity * 0.5) * (0.5 + recency * 0.5);

      const reasons: string[] = [];
      const rarest = [...overlap]
        .sort((a, b) => (options.idf.get(b) ?? 0) - (options.idf.get(a) ?? 0))
        .slice(0, 3);
      if (rarest.length > 0) reasons.push(`shares ${rarest.join(', ')}`);
      if (affinity > 0.5) reasons.push('same folder');
      else if (affinity > 0) reasons.push('nearby folder');
      if (recency > 0.7) reasons.push('recent');

      scored.push({ ...passage, score, reasons });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  // One passage per document — five excerpts from one file is not a corpus view.
  const seen = new Set<string>();
  const best: ScoredPassage[] = [];
  for (const passage of scored) {
    if (seen.has(passage.docId)) continue;
    seen.add(passage.docId);
    best.push(passage);
    if (best.length >= (query.limit ?? 5)) break;
  }

  return best;
}
