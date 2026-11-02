import { isComplex, sentences, syllables, words } from './segment';

/**
 * Readability by consensus vote rather than by single score.
 *
 * Every one of these formulas was fitted to a different corpus in a different
 * decade, and each is wrong in its own direction — Flesch-Kincaid punishes long
 * words regardless of familiarity, Gunning Fog counts any three-syllable word as
 * hard, LIX ignores syllables entirely. Reporting one of them as *the* grade is
 * false precision.
 *
 * So: compute seven, convert each to a US grade level, and only report difficulty
 * when a majority agree. This is the approach `retext-readability` settled on and
 * it is the right one — a sentence that four independent formulas call hard is
 * probably hard.
 */

export interface ReadabilityStats {
  readonly words: number;
  readonly sentences: number;
  readonly syllables: number;
  readonly complexWords: number;
  readonly characters: number;
  readonly longWords: number;
}

export interface ReadabilityScores {
  readonly fleschReadingEase: number;
  readonly fleschKincaidGrade: number;
  readonly gunningFog: number;
  readonly smog: number;
  readonly colemanLiau: number;
  readonly automatedReadability: number;
  readonly lix: number;
}

export const FORMULA_COUNT = 7;

export function collectStats(text: string): ReadabilityStats {
  const sentenceList = sentences(text);
  const wordList = words(text);

  let syllableCount = 0;
  let complexCount = 0;
  let characters = 0;
  let longWords = 0;

  for (const word of wordList) {
    syllableCount += syllables(word);
    if (isComplex(word)) complexCount++;
    characters += word.length;
    if (word.length > 6) longWords++;
  }

  return {
    words: wordList.length,
    sentences: Math.max(1, sentenceList.length),
    syllables: syllableCount,
    complexWords: complexCount,
    characters,
    longWords,
  };
}

export function score(stats: ReadabilityStats): ReadabilityScores {
  const { words: w, sentences: s, syllables: syl, complexWords: cw, characters: ch, longWords: lw } =
    stats;

  if (w === 0) {
    return {
      fleschReadingEase: 100,
      fleschKincaidGrade: 0,
      gunningFog: 0,
      smog: 0,
      colemanLiau: 0,
      automatedReadability: 0,
      lix: 0,
    };
  }

  const wordsPerSentence = w / s;
  const syllablesPerWord = syl / w;
  const charsPer100 = (ch / w) * 100;
  const sentencesPer100 = (s / w) * 100;

  return {
    fleschReadingEase: 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord,
    fleschKincaidGrade: 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59,
    gunningFog: 0.4 * (wordsPerSentence + 100 * (cw / w)),
    // SMOG is defined over 30 sentences; scaling keeps it usable on shorter runs
    // at the cost of some accuracy, which the consensus vote absorbs.
    smog: 1.043 * Math.sqrt(cw * (30 / s)) + 3.1291,
    colemanLiau: 0.0588 * charsPer100 - 0.296 * sentencesPer100 - 15.8,
    automatedReadability: 4.71 * (ch / w) + 0.5 * wordsPerSentence - 21.43,
    lix: wordsPerSentence + (100 * lw) / w,
  };
}

/** Convert each formula to a US grade level so they can be compared. */
export function grades(scores: ReadabilityScores): number[] {
  return [
    fleschEaseToGrade(scores.fleschReadingEase),
    scores.fleschKincaidGrade,
    scores.gunningFog,
    scores.smog,
    scores.colemanLiau,
    scores.automatedReadability,
    lixToGrade(scores.lix),
  ];
}

/** Flesch Reading Ease runs backwards — 100 is easy, 0 is punishing. */
export function fleschEaseToGrade(ease: number): number {
  if (ease >= 90) return 5;
  if (ease >= 80) return 6;
  if (ease >= 70) return 7;
  if (ease >= 60) return 8.5;
  if (ease >= 50) return 11;
  if (ease >= 30) return 14;
  return 16;
}

/** LIX bands, per its usual interpretation table. */
export function lixToGrade(lix: number): number {
  if (lix < 25) return 5;
  if (lix < 30) return 6;
  if (lix < 35) return 7;
  if (lix < 40) return 8;
  if (lix < 45) return 10;
  if (lix < 50) return 12;
  if (lix < 55) return 14;
  return 16;
}

export interface ReadabilityVerdict {
  readonly scores: ReadabilityScores;
  readonly grades: readonly number[];
  /** Median grade across the seven formulas. */
  readonly consensusGrade: number;
  /** How many formulas call this harder than the target. */
  readonly votesHarder: number;
  /** True only when a majority agree. */
  readonly isHard: boolean;
}

/**
 * `target` is a US grade level. 9 is a reasonable default for general prose —
 * it is roughly where mainstream journalism sits.
 */
export function assess(text: string, target = 9, minVotes = 4): ReadabilityVerdict {
  const scores = score(collectStats(text));
  const gradeList = grades(scores);
  const votesHarder = gradeList.filter((g) => g > target).length;

  const sorted = [...gradeList].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const consensusGrade = sorted[mid] ?? 0;

  return {
    scores,
    grades: gradeList,
    consensusGrade,
    votesHarder,
    isHard: votesHarder >= minVotes,
  };
}
