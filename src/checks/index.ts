import { Relevance, type SuggestionRequest } from '../scheduler/types';
import { findEchoes } from './echo';
import { assess } from './readability';
import { analyseParagraphs, repeatedOpeners } from './rhythm';
import { paragraphs, sentences, syllables, words } from './segment';
import { findStyleIssues } from './style';

export interface ReviewOptions {
  /** US grade level the prose is aiming at. */
  readonly targetGrade?: number;
  /** Skip everything below this confidence. */
  readonly minConfidence?: number;
}

/**
 * Runs the deterministic checks over a document and returns candidate
 * suggestions.
 *
 * Returns candidates — it does not show them. Everything here posts to the queue
 * and the renderer decides whether anything reaches the writer, which is the
 * whole point of that split: a check that finds something is not a licence to
 * interrupt.
 *
 * Document-level findings are `Document`-relevant, so the policy holds them for
 * a medium seam. Sentence-local findings are `Sentence`-relevant and may fire at
 * a fine one.
 */
export function review(text: string, options: ReviewOptions = {}): SuggestionRequest[] {
  const targetGrade = options.targetGrade ?? 9;
  const minConfidence = options.minConfidence ?? 0.6;

  const out: SuggestionRequest[] = [];
  const trimmed = text.trim();
  // Below this there is nothing to say that would not be noise.
  if (trimmed.length < 200) return out;

  // --- Document-level. The tier no sentence-scoped linter reaches. -----------

  for (const echo of findEchoes(trimmed).slice(0, 2)) {
    out.push({
      kind: 'echo',
      relevance: Relevance.Document,
      confidence: echo.wordCount >= 5 ? 0.9 : 0.75,
      text: `You use "${echo.phrase}" ${echo.positions.length} times close together.`,
      dedupeKey: `echo:${echo.phrase}`,
      ...anchorOf(spanOfWords(trimmed, echo.positions[0] ?? 0, echo.wordCount)),
      payload: echo,
    });
  }

  for (const opener of repeatedOpeners(trimmed).slice(0, 1)) {
    out.push({
      kind: 'repeated-opener',
      relevance: Relevance.Document,
      confidence: 0.8,
      text: `${opener.count} sentences in a row start with "${opener.word}".`,
      dedupeKey: `opener:${opener.word}`,
      ...anchorOf(clipAnchor(sentences(trimmed)[opener.firstSentenceIndex]?.text)),
      payload: opener,
    });
  }


  // A grade number alone gives the writer nothing to do. Point at the sentence
  // doing the most damage instead, so the note can be located and fixed.
  const readability = assess(trimmed, targetGrade);
  if (readability.isHard) {
    const worst = hardestSentence(trimmed);
    if (worst) {
      out.push({
        kind: 'readability',
        relevance: Relevance.Document,
        confidence: 0.5 + readability.votesHarder * 0.07,
        text: `Hardest sentence to read: ${worst.words} words, ${readingLevel(worst.grade)}. Splitting it would help most.`,
        ...anchorOf(clipAnchor(worst.text)),
        payload: readability,
      });
    }
  }

  const paragraphBalance = analyseParagraphs(trimmed);
  if (paragraphBalance.overlong.length > 0 && paragraphBalance.count >= 3) {
    out.push({
      kind: 'paragraph-balance',
      relevance: Relevance.Document,
      confidence: 0.6,
      text: `Paragraph ${(paragraphBalance.overlong[0] ?? 0) + 1} is more than twice your average length.`,
      ...anchorOf(clipAnchor(paragraphs(trimmed)[paragraphBalance.overlong[0] ?? 0]?.text)),
      payload: paragraphBalance,
    });
  }


  // --- Sentence-local. Harper covers grammar; these are style. --------------

  const style = findStyleIssues(trimmed);
  const byRule = new Map<string, typeof style>();
  for (const finding of style) {
    const bucket = byRule.get(finding.rule);
    if (bucket) bucket.push(finding);
    else byRule.set(finding.rule, [finding]);
  }

  for (const [rule, findings] of byRule) {
    const first = findings[0];
    if (!first || first.confidence < minConfidence) continue;
    out.push({
      kind: rule,
      relevance: Relevance.Sentence,
      confidence: first.confidence,
      text: styleNoteText(first.message, first.match, findings.length),
      dedupeKey: rule,
      ...anchorOf(trimmed.slice(first.start, first.end)),
      payload: findings,
    });
  }

  return out.sort((a, b) => b.confidence - a.confidence);
}

/**
 * The sentence with the highest Flesch-Kincaid grade, among sentences long
 * enough to matter. Short sentences can score high on one long word; those are
 * not what makes a document hard.
 */
export function hardestSentence(
  text: string,
): { text: string; words: number; grade: number } | undefined {
  let best: { text: string; words: number; grade: number } | undefined;
  for (const sentence of sentences(text)) {
    const list = words(sentence.text);
    if (list.length < 12) continue;
    const syl = list.reduce((sum, w) => sum + syllables(w), 0);
    const grade = Math.round(0.39 * list.length + 11.8 * (syl / list.length) - 15.59);
    if (!best || grade > best.grade) best = { text: sentence.text, words: list.length, grade };
  }
  return best;
}

/**
 * A grade number past high school means nothing to a reader ("grade 48" is a
 * 115-word sentence, not a level anyone recognises), so name the band instead.
 */
export function readingLevel(grade: number): string {
  if (grade > 16) return 'harder than college level';
  if (grade > 12) return 'college reading level';
  return `about a grade ${grade} reading level`;
}

/**
 * One note for every hit of a style rule. The quote is left off when the
 * message already carries it (Wordy's "x" → "y"), so it is not said twice.
 */
export function styleNoteText(message: string, match: string, count: number): string {
  const quoted = message.toLowerCase().includes(`"${match.toLowerCase()}"`);
  if (count === 1) return quoted ? message : `${message} ("${match}")`;
  return quoted
    ? `${message} — and ${count - 1} more`
    : `${message} — ${count} instances, first: "${match}"`;
}

/** Spread-friendly: omit the key entirely when there is nothing to point at. */
function anchorOf(text: string | undefined): { anchor?: string } {
  return text && text.trim().length > 0 ? { anchor: text } : {};
}

/** The first `count` words starting at `start`, as they appear in the text. */
export function spanOfWords(text: string, start: number, count: number): string | undefined {
  const pattern = /[\p{L}\p{N}']+/gu;
  pattern.lastIndex = start;
  let end = start;
  for (let i = 0; i < count; i++) {
    const match = pattern.exec(text);
    if (!match) return undefined;
    end = match.index + match[0].length;
  }
  return text.slice(start, end);
}

/**
 * A long passage only needs its opening to be found again. Cut on a word
 * boundary so the snippet is still verbatim text.
 */
function clipAnchor(text: string | undefined, max = 80): string | undefined {
  if (!text || text.length <= max) return text;
  const cut = text.lastIndexOf(' ', max);
  return text.slice(0, cut > 20 ? cut : max);
}

export { findEchoes } from './echo';
export { assess as assessReadability } from './readability';
export { analyseParagraphs, analyseRhythm, repeatedOpeners } from './rhythm';
export { analyseAdverbs, findStyleIssues } from './style';
export { paragraphs, sentences, syllables, words } from './segment';
