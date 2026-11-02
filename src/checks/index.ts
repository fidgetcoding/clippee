import { Relevance, type SuggestionRequest } from '../scheduler/types';
import { findEchoes } from './echo';
import { assess } from './readability';
import { analyseParagraphs, analyseRhythm, repeatedOpeners } from './rhythm';
import { analyseAdverbs, findStyleIssues } from './style';

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
      payload: opener,
    });
  }

  const rhythm = analyseRhythm(trimmed);
  if (rhythm.isMonotonous) {
    out.push({
      kind: 'monotonous-rhythm',
      relevance: Relevance.Document,
      confidence: 0.65,
      text: `Every sentence is about ${Math.round(rhythm.meanSentenceWords)} words. Vary one.`,
      payload: rhythm,
    });
  }

  const readability = assess(trimmed, targetGrade);
  if (readability.isHard) {
    out.push({
      kind: 'readability',
      relevance: Relevance.Document,
      confidence: 0.5 + readability.votesHarder * 0.07,
      text: `Reading level ~grade ${Math.round(readability.consensusGrade)} — ${readability.votesHarder} of 7 formulas call this hard.`,
      payload: readability,
    });
  }

  const paragraphBalance = analyseParagraphs(trimmed);
  if (paragraphBalance.overlong.length > 0 && paragraphBalance.count >= 3) {
    out.push({
      kind: 'paragraph-balance',
      relevance: Relevance.Document,
      confidence: 0.6,
      text: `Paragraph ${(paragraphBalance.overlong[0] ?? 0) + 1} is more than twice your average length.`,
      payload: paragraphBalance,
    });
  }

  const adverbs = analyseAdverbs(trimmed);
  if (adverbs.isHeavy) {
    out.push({
      kind: 'adverb-density',
      relevance: Relevance.Document,
      confidence: 0.65,
      text: `${adverbs.count} -ly adverbs in ${adverbs.total} words (${(adverbs.ratio * 100).toFixed(1)}%).`,
      payload: adverbs,
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
      text:
        findings.length === 1
          ? `${first.message} ("${first.match}")`
          : `${first.message} — ${findings.length} instances, first: "${first.match}"`,
      dedupeKey: rule,
      payload: findings,
    });
  }

  return out.sort((a, b) => b.confidence - a.confidence);
}

export { findEchoes } from './echo';
export { assess as assessReadability } from './readability';
export { analyseParagraphs, analyseRhythm, repeatedOpeners } from './rhythm';
export { analyseAdverbs, findStyleIssues } from './style';
export { paragraphs, sentences, syllables, words } from './segment';
