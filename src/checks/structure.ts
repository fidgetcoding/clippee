import { paragraphs, sentences, words } from './segment';

/**
 * Document structure: sections, promises, and balance.
 *
 * This is the tier no incumbent reaches. ProWritingAid's 25 reports, Grammarly's
 * four categories and Hemingway's four highlight classes are all sentence-scoped,
 * because sentence-scoped is what fits under an inline underline. Nothing on the
 * market tells you the intro promised three things and the document delivered
 * two.
 *
 * A constraint worth stating: reading a Google Doc through the annotation hook
 * yields plain text with no heading markup, so sections are inferred rather than
 * read. The Docs REST API returns real paragraph styles (`HEADING_1` and so on)
 * and would make this exact — worth switching to if the heuristic proves shaky
 * on real documents.
 */

export interface Section {
  readonly heading: string;
  /** Character offset of the heading line. */
  readonly start: number;
  readonly wordCount: number;
  /** Body text under this heading, excluding the heading itself. */
  readonly body: string;
}

/** Longest a line can be and still read as a heading. */
const MAX_HEADING_CHARS = 90;

/**
 * Does this line look like a heading?
 *
 * Deliberately strict. A false heading fragments the document and every
 * downstream measure inherits the error, so the rule requires several signals at
 * once: short, no terminal punctuation, and either title-cased, upper-cased, or
 * numbered.
 */
export function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_HEADING_CHARS) return false;
  // A sentence ends in punctuation; a heading generally does not.
  if (/[.!?,;:]$/.test(trimmed)) return false;

  const wordList = words(trimmed);
  if (wordList.length === 0 || wordList.length > 12) return false;

  const upper = /^[^a-z]*$/.test(trimmed) && /[A-Z]/.test(trimmed);
  const numbered = /^(?:\d+[.)]|chapter|part|section|page|panel|step)\b/i.test(trimmed);
  const titleCase =
    wordList.length >= 2 &&
    wordList.filter((w) => /^[A-Z]/.test(w)).length / wordList.length >= 0.6;

  return upper || numbered || titleCase;
}

/** Split a document into sections on inferred headings. */
export function outline(text: string): Section[] {
  const lines = text.split('\n');
  const sections: Section[] = [];

  let offset = 0;
  let current: { heading: string; start: number; body: string[] } | undefined;

  const close = (): void => {
    if (!current) return;
    const body = current.body.join('\n').trim();
    sections.push({
      heading: current.heading,
      start: current.start,
      body,
      wordCount: words(body).length,
    });
  };

  for (const line of lines) {
    if (looksLikeHeading(line)) {
      close();
      current = { heading: line.trim(), start: offset, body: [] };
    } else if (current) {
      current.body.push(line);
    }
    offset += line.length + 1;
  }
  close();

  return sections;
}

export interface Promise_ {
  /** The sentence that made the commitment. */
  readonly text: string;
  readonly offset: number;
  /** What the promise appears to cover, if it enumerated. */
  readonly items: readonly string[];
  /** A stated count — "three reasons" — when one was given. */
  readonly count?: number;
}

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** Forward-looking commitments: "this covers", "we'll look at", "below". */
const FORWARD = /\b(?:will|we'?ll|i'?ll|this (?:piece|post|doc\w*|essay|chapter|section)|below|follows?|covers?|explores?|examines?|walks? through|breaks? down|looks? at)\b/i;

/**
 * Find sentences in the opening that commit to covering something.
 *
 * Scoped to the opening because a promise made in the last paragraph is a
 * summary, not a commitment. Enumerated counts ("three reasons") are the
 * strongest signal and the easiest to check.
 */
export function findPromises(text: string, openingChars = 2_000): Promise_[] {
  const opening = text.slice(0, openingChars);
  const found: Promise_[] = [];

  for (const sentence of sentences(opening)) {
    const lower = sentence.text.toLowerCase();

    const countMatch = /\b(two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:key\s+|main\s+|core\s+)?(?:things?|reasons?|points?|parts?|sections?|steps?|ways?|questions?|problems?|areas?|themes?)\b/i.exec(
      sentence.text,
    );
    const hasForward = FORWARD.test(sentence.text);
    if (!countMatch && !hasForward) continue;

    // A colon list is the clearest enumeration a sentence can carry.
    const afterColon = sentence.text.split(':')[1];
    const items = afterColon
      ? afterColon
          .split(/[,;]| and /i)
          .map((part) => part.trim().replace(/\.$/, ''))
          .filter((part) => part.length > 2)
      : [];

    const raw = countMatch?.[1]?.toLowerCase();
    const count = raw ? (NUMBER_WORDS[raw] ?? Number.parseInt(raw, 10)) : undefined;

    found.push({
      text: sentence.text,
      offset: sentence.start,
      items,
      ...(Number.isFinite(count) ? { count: count as number } : {}),
    });

    void lower;
  }

  return found;
}

export interface BalanceReport {
  readonly sections: readonly Section[];
  readonly meanWords: number;
  /** Sections more than twice the mean. */
  readonly bloated: readonly Section[];
  /** Sections under a third of the mean, ignoring very short documents. */
  readonly thin: readonly Section[];
}

/**
 * Section balance.
 *
 * Word counts are local and free; whether the imbalance *matters* is a judgement
 * only a model can make — 900 words on a minor point is only a problem if the
 * point is minor. This reports the shape and leaves the verdict alone.
 */
export function analyseBalance(text: string): BalanceReport {
  const sections = outline(text);
  if (sections.length < 3) {
    return { sections, meanWords: 0, bloated: [], thin: [] };
  }

  const counts = sections.map((s) => s.wordCount);
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;

  return {
    sections,
    meanWords: mean,
    bloated: sections.filter((s) => s.wordCount > mean * 2),
    thin: sections.filter((s) => s.wordCount > 0 && s.wordCount < mean * 0.33),
  };
}

export interface StructureSignal {
  readonly kind: 'promise' | 'imbalance' | 'no-structure';
  readonly detail: string;
  /** Fed to the model when a cloud call is warranted. */
  readonly evidence: readonly string[];
}

/**
 * The local pass.
 *
 * Produces candidates, never verdicts. Whether a promise was actually delivered
 * needs a model to read the document; this decides whether that call is worth
 * making, which is the whole point of the local-first ladder.
 */
export function structureSignals(text: string): StructureSignal[] {
  const signals: StructureSignal[] = [];
  if (words(text).length < 300) return signals;

  const promises = findPromises(text);
  const balance = analyseBalance(text);

  for (const promise of promises) {
    // A stated count is checkable; a vague forward reference is not worth a call
    // unless the document also has sections to check it against.
    if (promise.count === undefined && balance.sections.length === 0) continue;
    signals.push({
      kind: 'promise',
      detail:
        promise.count !== undefined
          ? `Opening promises ${String(promise.count)} things; document has ${String(balance.sections.length)} sections.`
          : 'Opening makes a forward commitment.',
      evidence: [promise.text, ...balance.sections.slice(0, 20).map((s) => s.heading)],
    });
  }

  if (balance.bloated.length > 0) {
    const worst = balance.bloated[0];
    if (worst) {
      signals.push({
        kind: 'imbalance',
        detail: `"${worst.heading}" is ${Math.round(worst.wordCount / balance.meanWords)}× your average section.`,
        evidence: balance.sections.map((s) => `${s.heading} — ${String(s.wordCount)} words`),
      });
    }
  }

  if (balance.sections.length === 0 && paragraphs(text).length > 8) {
    signals.push({
      kind: 'no-structure',
      detail: 'Long document with no headings at all.',
      evidence: [],
    });
  }

  return signals;
}
