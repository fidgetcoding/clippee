import { paragraphs, sentences, words } from './segment';

/**
 * Document-level shape: variance, repetition of openers, paragraph balance.
 *
 * This is the tier Harper explicitly does not reach. Its own comparison puts it
 * at sentence-local rule matching — it catches "the the", not "every sentence in
 * this section starts with 'The'". Nothing permissively licensed ships these, so
 * they are built here.
 */

export interface RhythmReport {
  readonly sentenceCount: number;
  readonly meanSentenceWords: number;
  /** Population standard deviation of sentence length, in words. */
  readonly sentenceLengthStdDev: number;
  /** Low variance reads as monotonous regardless of whether length is good. */
  readonly isMonotonous: boolean;
  readonly longestSentenceWords: number;
}

/**
 * Under ~4 words of spread, prose reads as metronomic even when every individual
 * sentence is fine. Requires a few sentences before it means anything.
 */
const MONOTONY_STDDEV = 4;
const MONOTONY_MIN_SENTENCES = 5;

export function analyseRhythm(text: string): RhythmReport {
  const lengths = sentences(text).map((s) => words(s.text).length);
  const n = lengths.length;

  if (n === 0) {
    return {
      sentenceCount: 0,
      meanSentenceWords: 0,
      sentenceLengthStdDev: 0,
      isMonotonous: false,
      longestSentenceWords: 0,
    };
  }

  const mean = lengths.reduce((a, b) => a + b, 0) / n;
  const variance = lengths.reduce((acc, l) => acc + (l - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  return {
    sentenceCount: n,
    meanSentenceWords: mean,
    sentenceLengthStdDev: stdDev,
    isMonotonous: n >= MONOTONY_MIN_SENTENCES && stdDev < MONOTONY_STDDEV,
    longestSentenceWords: Math.max(...lengths),
  };
}

export interface RepeatedOpener {
  readonly word: string;
  readonly count: number;
  /** Index of the first sentence in the run. */
  readonly firstSentenceIndex: number;
}

/**
 * Runs of consecutive sentences opening on the same word.
 *
 * Three in a row is the threshold: two is coincidence and often deliberate
 * parallelism, four is unmistakable. Articles are excluded — "The" opening three
 * consecutive sentences is normal English, not a tell.
 */
const OPENER_RUN_THRESHOLD = 3;
const IGNORED_OPENERS = new Set(['the', 'a', 'an', 'it', 'this', 'that', 'there']);

export function repeatedOpeners(text: string, threshold = OPENER_RUN_THRESHOLD): RepeatedOpener[] {
  const openers = sentences(text).map((s) => (words(s.text)[0] ?? '').toLowerCase());
  const found: RepeatedOpener[] = [];

  let runStart = 0;
  for (let i = 1; i <= openers.length; i++) {
    if (i < openers.length && openers[i] === openers[runStart]) continue;

    const word = openers[runStart];
    const count = i - runStart;
    if (word && count >= threshold && !IGNORED_OPENERS.has(word)) {
      found.push({ word, count, firstSentenceIndex: runStart });
    }
    runStart = i;
  }

  return found;
}

export interface ParagraphBalance {
  readonly count: number;
  readonly meanWords: number;
  /** Paragraphs more than twice the mean length. */
  readonly overlong: readonly number[];
}

export function analyseParagraphs(text: string): ParagraphBalance {
  const blocks = paragraphs(text);
  const lengths = blocks.map((p) => words(p.text).length);
  if (lengths.length === 0) return { count: 0, meanWords: 0, overlong: [] };

  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const overlong = lengths
    .map((len, i) => ({ len, i }))
    .filter(({ len }) => mean > 0 && len > mean * 2)
    .map(({ i }) => i);

  return { count: lengths.length, meanWords: mean, overlong };
}
