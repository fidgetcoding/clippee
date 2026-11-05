/**
 * Echo detection — the same phrase reused close to itself.
 *
 * This is ProWritingAid's "All Repeats" report, and it is the cheapest check in
 * the catalogue that a sentence-scoped linter structurally cannot do. Harper's
 * `repeated_words` catches "the the"; this catches "at the end of the day" twice
 * in two paragraphs, which is the one the writer actually wants to know about.
 *
 * Pure string work, no model, no network.
 */

export interface Echo {
  /** Normalised phrase, lowercase, whitespace collapsed. */
  readonly phrase: string;
  readonly wordCount: number;
  /** Character offsets of each occurrence, in document order. */
  readonly positions: readonly number[];
  /** Characters between the first two occurrences. */
  readonly gap: number;
}

export interface EchoOptions {
  /** Shortest phrase worth reporting, in words. */
  readonly minWords?: number;
  /** Longest phrase to index. Bounds the work on large documents. */
  readonly maxWords?: number;
  /** Occurrences further apart than this are not echoes, they are structure. */
  readonly windowChars?: number;
}

const DEFAULTS = { minWords: 3, maxWords: 8, windowChars: 1_500 } as const;

interface Token {
  readonly word: string;
  readonly start: number;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /[\p{L}\p{N}']+/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    tokens.push({ word: match[0].toLowerCase(), start: match.index });
  }
  return tokens;
}

/**
 * Find repeated phrases within `windowChars` of one another.
 *
 * Longest-match-wins: if "at the end of the day" repeats, its shorter substrings
 * repeat too, and reporting all of them would bury the useful finding. Any echo
 * whose positions are fully covered by a longer echo is dropped.
 */
export function findEchoes(text: string, options: EchoOptions = {}): Echo[] {
  const minWords = options.minWords ?? DEFAULTS.minWords;
  const maxWords = options.maxWords ?? DEFAULTS.maxWords;
  const windowChars = options.windowChars ?? DEFAULTS.windowChars;

  const tokens = tokenize(text);
  if (tokens.length < minWords * 2) return [];

  const found: Echo[] = [];

  // Longest first so the covering-echo filter has something to compare against.
  for (let n = Math.min(maxWords, tokens.length); n >= minWords; n--) {
    const seen = new Map<string, number[]>();

    for (let i = 0; i + n <= tokens.length; i++) {
      const slice = tokens.slice(i, i + n);
      const phrase = slice.map((t) => t.word).join(' ');
      const start = slice[0]?.start ?? 0;
      const positions = seen.get(phrase);
      if (positions) positions.push(start);
      else seen.set(phrase, [start]);
    }

    for (const [phrase, positions] of seen) {
      if (positions.length < 2) continue;

      // Only the occurrences that are actually near each other count.
      const near = positions.filter((pos, idx) => {
        const prev = positions[idx - 1];
        const next = positions[idx + 1];
        return (
          (prev !== undefined && pos - prev <= windowChars) ||
          (next !== undefined && next - pos <= windowChars)
        );
      });
      if (near.length < 2) continue;

      const first = near[0] ?? 0;
      const second = near[1] ?? 0;

      if (isCoveredBy(found, near, n)) continue;

      found.push({ phrase, wordCount: n, positions: near, gap: second - first });
    }
  }

  return found.sort((a, b) => b.wordCount - a.wordCount || a.gap - b.gap);
}

/**
 * True when an echo already reported covers these positions: a substring of an
 * existing finding, or a same-length window shifted along it. A repeat longer
 * than `maxWords` shows up as several overlapping windows ("a comparative …
 * form" and "comparative … form in"), and they are one echo, not two.
 */
function isCoveredBy(found: readonly Echo[], positions: readonly number[], wordCount: number): boolean {
  return found.some(
    (existing) =>
      existing.wordCount >= wordCount &&
      positions.every((pos) =>
        existing.positions.some((known) => Math.abs(known - pos) <= existing.wordCount * 12),
      ),
  );
}
