/**
 * Finding the text an edit targets.
 *
 * The model quotes the passage it wants changed, and it does not always quote
 * it byte for byte: a curly apostrophe comes back straight, a non-breaking space
 * comes back as a space. So matching runs twice — exact, then against a
 * normalised copy. The normalisation is strictly one character in, one
 * character out, which keeps every index in the normalised copy valid in the
 * original. That property is the whole reason this is a character map and not a
 * regex.
 */

const EQUIVALENTS: Readonly<Record<string, string>> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '′': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '″': '"',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  '–': '-',
  '—': '-',
  '−': '-',
  // Docs uses a vertical tab for a soft line break (shift+enter).
  '\u000B': '\n',
};

export function normalize(text: string): string {
  let out = '';
  for (const ch of text) {
    // `for...of` walks code points; an astral character is two code units and
    // must stay two, or every index after it shifts.
    out += ch.length === 1 ? (EQUIVALENTS[ch] ?? ch) : ch;
  }
  return out;
}

export type Located =
  | { readonly start: number; readonly end: number }
  | { readonly error: 'not-found' | 'ambiguous'; readonly count: number };

function occurrences(haystack: string, needle: string): number[] {
  const hits: number[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return hits;
    hits.push(at);
    from = at + 1;
  }
}

/**
 * Where `needle` sits in `haystack`.
 *
 * One hit is the answer. Several hits are refused unless the caller gives a
 * `near` index — replacing the wrong "the results" silently is worse than not
 * replacing anything. Undo passes `near`, because it knows exactly where it
 * wrote.
 *
 * An empty needle only makes sense with `near`: it means "insert here", which
 * is how a deletion is undone.
 */
export function locate(haystack: string, needle: string, near?: number): Located {
  if (needle.length === 0) {
    if (near === undefined || near < 0 || near > haystack.length) {
      return { error: 'not-found', count: 0 };
    }
    return { start: near, end: near };
  }

  let hits = occurrences(haystack, needle);
  if (hits.length === 0) hits = occurrences(normalize(haystack), normalize(needle));
  if (hits.length === 0) return { error: 'not-found', count: 0 };

  if (hits.length === 1 || near !== undefined) {
    const start =
      near === undefined
        ? (hits[0] as number)
        : hits.reduce((best, at) => (Math.abs(at - near) < Math.abs(best - near) ? at : best));
    return { start, end: start + needle.length };
  }

  return { error: 'ambiguous', count: hits.length };
}

/** Did `expected` land at `start`? Compared normalised, for the same reasons. */
export function landed(text: string, start: number, expected: string): boolean {
  return normalize(text.slice(start, start + expected.length)) === normalize(expected);
}
