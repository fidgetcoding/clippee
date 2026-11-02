/**
 * Text segmentation.
 *
 * Uses `Intl.Segmenter`, which ships in every current browser and in Node, so
 * there is no tokenizer dependency and no wordlist to keep current. Sentence
 * segmentation by regex gets abbreviations, decimals and quotes wrong in ways
 * that produce confident nonsense downstream — a bad sentence split turns into a
 * bad readability score turns into a suggestion the writer correctly ignores.
 */

export interface Sentence {
  readonly text: string;
  /** Offset into the source text. */
  readonly start: number;
  readonly end: number;
}

export interface Paragraph {
  readonly text: string;
  readonly start: number;
  readonly sentences: readonly Sentence[];
}

const segmenterCache = new Map<string, Intl.Segmenter>();

function segmenter(granularity: Intl.SegmenterOptions['granularity'], locale = 'en'): Intl.Segmenter {
  const key = `${locale}:${granularity}`;
  let found = segmenterCache.get(key);
  if (!found) {
    found = new Intl.Segmenter(locale, { granularity });
    segmenterCache.set(key, found);
  }
  return found;
}

/** Word-like tokens only — punctuation and whitespace segments are dropped. */
export function words(text: string): string[] {
  const out: string[] = [];
  for (const segment of segmenter('word').segment(text)) {
    if (segment.isWordLike) out.push(segment.segment);
  }
  return out;
}

export function sentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  for (const segment of segmenter('sentence').segment(text)) {
    const trimmed = segment.segment.trim();
    if (trimmed.length === 0) continue;
    // Re-anchor onto the trimmed span so offsets point at real characters.
    const leading = segment.segment.length - segment.segment.trimStart().length;
    const start = segment.index + leading;
    out.push({ text: trimmed, start, end: start + trimmed.length });
  }
  return out;
}

/** Blank-line separated blocks, each with its own sentence list. */
export function paragraphs(text: string): Paragraph[] {
  const out: Paragraph[] = [];
  const pattern = /\n[ \t]*\n+/g;

  let cursor = 0;
  let match: RegExpExecArray | null;

  const push = (raw: string, offset: number): void => {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return;
    const start = offset + (raw.length - raw.trimStart().length);
    out.push({ text: trimmed, start, sentences: sentences(trimmed) });
  };

  while ((match = pattern.exec(text)) !== null) {
    push(text.slice(cursor, match.index), cursor);
    cursor = match.index + match[0].length;
  }
  push(text.slice(cursor), cursor);

  return out;
}

/**
 * Syllable estimate for the readability formulas.
 *
 * A heuristic, and openly so: vowel groups, minus a silent terminal `e`, plus a
 * correction for `-le` endings, floored at one. Dictionary-accurate counting
 * needs a pronunciation dictionary, and the formulas that consume this are
 * themselves coarse enough that the extra precision changes no decision.
 */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length === 0) return 0;
  if (w.length <= 3) return 1;

  // The `[^laeiouy]e$` clause deliberately does NOT strip a terminal -le, so
  // "table" keeps its `e` and counts as ta-ble. No further correction is needed —
  // adding one double-counts the same nucleus.
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 0);
}

/** Words of three or more syllables, excluding common inflected forms. */
export function isComplex(word: string): boolean {
  const w = word.toLowerCase();
  if (w.length < 3) return false;
  if (/(?:es|ed|ing)$/.test(w) && syllables(w.replace(/(?:es|ed|ing)$/, '')) < 3) return false;
  return syllables(w) >= 3;
}
