import { sentences, words } from './segment';

/**
 * Sentence-local style checks.
 *
 * The engine is a pattern matcher over word lists; the lists here are a seed set
 * covering the categories that write-good, proselint and the Vale style packages
 * all agree on. Vale ships the Microsoft, Google and IBM guides as data files, so
 * the intended end state is loading those as packs rather than growing this file
 * — the format below is deliberately list-shaped for that reason.
 *
 * Precision over coverage, throughout. The grammar-correction field standard is
 * F₀.₅, which weights precision twice as heavily as recall, and the canonical
 * study of why developers abandon this class of tool found false positives were
 * one of the two barriers to use. A check that fires on a correct sentence costs
 * more than a check that stays silent on a bad one.
 */

export interface StyleFinding {
  readonly rule: string;
  readonly match: string;
  readonly start: number;
  readonly end: number;
  readonly message: string;
  /** 0-1. Only high-confidence rules should default to on. */
  readonly confidence: number;
}

export interface RuleList {
  readonly rule: string;
  readonly terms: readonly string[];
  readonly message: string;
  readonly confidence: number;
}

/** Softeners that drain a sentence of its claim. */
export const HEDGES: RuleList = {
  rule: 'hedging',
  terms: [
    'i think', 'i believe', 'i feel like', 'it seems', 'seems like',
    'somewhat', 'arguably', 'possibly', 'perhaps', 'maybe',
    'more or less', 'in my opinion', 'it could be argued',
    // Deliberately absent: "kind of" and "sort of". Both are ordinary noun
    // phrases at least as often as they are hedges — "its own kind of win" is
    // not hedging — and distinguishing the two needs a POS tag we do not have
    // here. Precision over coverage; Harper can have this one.
    // Also absent: "fairly" and "rather", which are adverbs of degree far more
    // often than they are softeners.
  ],
  message: 'Hedge — the sentence is stronger without it.',
  confidence: 0.7,
};

/** Intensifiers that add emphasis without adding information. */
export const WEASELS: RuleList = {
  rule: 'weasel',
  terms: [
    'very', 'really', 'quite', 'extremely', 'incredibly', 'actually', 'basically',
    'literally', 'simply', 'just', 'totally', 'definitely', 'certainly',
    'absolutely', 'utterly', 'truly', 'highly', 'a lot of', 'several', 'various',
  ],
  message: 'Intensifier — usually cuts without loss.',
  confidence: 0.6,
};

/** Phrases that mark throat-clearing before the actual point. */
export const METADISCOURSE: RuleList = {
  rule: 'metadiscourse',
  terms: [
    'it should be noted that', 'it is important to note that', 'it is worth noting that',
    'needless to say', 'as previously mentioned', 'at the end of the day',
    'when all is said and done', 'for all intents and purposes', 'the fact of the matter is',
  ],
  message: 'Throat-clearing — start at the point.',
  confidence: 0.85,
};

/** Multi-word phrases with a one-word equivalent. */
export const WORDY: Readonly<Record<string, string>> = {
  'in order to': 'to',
  'in order for': 'for',
  'due to the fact that': 'because',
  'despite the fact that': 'although',
  'in spite of the fact that': 'although',
  'for the purpose of': 'to',
  'in the event that': 'if',
  'at this point in time': 'now',
  'at the present time': 'now',
  'a large number of': 'many',
  'the majority of': 'most',
  'has the ability to': 'can',
  'is able to': 'can',
  'make a decision': 'decide',
  'take into consideration': 'consider',
  'come to the conclusion': 'conclude',
  'give consideration to': 'consider',
  'in the near future': 'soon',
  'on a regular basis': 'regularly',
  'a sufficient amount of': 'enough',
};

const BE_VERBS = ['is', 'are', 'was', 'were', 'be', 'been', 'being', "isn't", "aren't", "wasn't", "weren't"];

/** Escape a term for use inside a word-boundary-anchored pattern. */
function termPattern(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'gi');
}

function scanList(text: string, list: RuleList): StyleFinding[] {
  const found: StyleFinding[] = [];
  for (const term of list.terms) {
    const pattern = termPattern(term);
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      found.push({
        rule: list.rule,
        match: match[0],
        start: match.index,
        end: match.index + match[0].length,
        message: list.message,
        confidence: list.confidence,
      });
    }
  }
  return found;
}

export function findWordy(text: string): StyleFinding[] {
  const found: StyleFinding[] = [];
  for (const [phrase, replacement] of Object.entries(WORDY)) {
    const pattern = termPattern(phrase);
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      found.push({
        rule: 'wordiness',
        match: match[0],
        start: match.index,
        end: match.index + match[0].length,
        message: `"${phrase}" → "${replacement}"`,
        confidence: 0.9,
      });
    }
  }
  return found;
}

/**
 * Passive voice, heuristically: a form of "to be" followed by a past participle,
 * optionally separated by an adverb.
 *
 * Deliberately conservative. Regular `-ed` participles and a short irregular list
 * only — chasing full coverage here means firing on "is embedded", and a passive
 * check that cries wolf is the first one a writer turns off.
 */
const IRREGULAR_PARTICIPLES = [
  'been', 'done', 'gone', 'made', 'seen', 'taken', 'given', 'written', 'known',
  'shown', 'held', 'kept', 'left', 'sent', 'built', 'brought', 'bought', 'caught',
  'found', 'told', 'said', 'put', 'set', 'run', 'begun', 'chosen', 'driven',
];

export function findPassive(text: string): StyleFinding[] {
  const be = BE_VERBS.join('|');
  const irregular = IRREGULAR_PARTICIPLES.join('|');
  const pattern = new RegExp(
    `\\b(${be})\\b(\\s+\\w+ly)?\\s+(\\w+ed|${irregular})\\b`,
    'gi',
  );

  const found: StyleFinding[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    found.push({
      rule: 'passive-voice',
      match: match[0],
      start: match.index,
      end: match.index + match[0].length,
      message: 'Passive — who is doing this?',
      confidence: 0.55,
    });
  }
  return found;
}

/** Sentences opening on "There is" / "There are" — the subject is buried. */
export function findThereIs(text: string): StyleFinding[] {
  const found: StyleFinding[] = [];
  for (const sentence of sentences(text)) {
    const match = /^there\s+(is|are|was|were)\b/i.exec(sentence.text);
    if (!match) continue;
    found.push({
      rule: 'there-is',
      match: match[0],
      start: sentence.start,
      end: sentence.start + match[0].length,
      message: 'Buried subject — name the thing doing the work.',
      confidence: 0.75,
    });
  }
  return found;
}

export interface AdverbReport {
  readonly count: number;
  readonly total: number;
  readonly ratio: number;
  readonly isHeavy: boolean;
}

/** `-ly` adverb density. Above roughly 4% reads as padded. */
export function analyseAdverbs(text: string, threshold = 0.04): AdverbReport {
  const all = words(text);
  const adverbs = all.filter((w) => /ly$/i.test(w) && w.length > 4);
  const ratio = all.length === 0 ? 0 : adverbs.length / all.length;
  return {
    count: adverbs.length,
    total: all.length,
    ratio,
    isHeavy: all.length >= 50 && ratio > threshold,
  };
}

/** Run every sentence-local style rule. */
export function findStyleIssues(text: string): StyleFinding[] {
  return [
    ...scanList(text, METADISCOURSE),
    ...findWordy(text),
    ...scanList(text, HEDGES),
    ...scanList(text, WEASELS),
    ...findThereIs(text),
    ...findPassive(text),
  ].sort((a, b) => a.start - b.start);
}
