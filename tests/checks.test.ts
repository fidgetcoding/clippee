import { describe, expect, it } from 'vitest';
import { findEchoes } from '../src/checks/echo';
import { assess, collectStats, score } from '../src/checks/readability';
import { analyseParagraphs, analyseRhythm, repeatedOpeners } from '../src/checks/rhythm';
import { paragraphs, sentences, syllables, words } from '../src/checks/segment';
import { analyseAdverbs, findPassive, findStyleIssues, findThereIs, findWordy } from '../src/checks/style';
import { readingLevel, review, styleNoteText } from '../src/checks';
import { Relevance } from '../src/scheduler/types';

describe('segmentation', () => {
  it('does not split on abbreviations or decimals', () => {
    // The reason for Intl.Segmenter over a regex: these are exactly the cases a
    // naive split gets wrong, and a bad split poisons every downstream metric.
    const text = 'The rate rose 3.5 percent in the U.S. last year. Analysts were surprised.';
    expect(sentences(text)).toHaveLength(2);
  });

  it('counts word-like tokens only', () => {
    expect(words('one, two — three!')).toEqual(['one', 'two', 'three']);
  });

  it('splits paragraphs on blank lines and keeps offsets', () => {
    const text = 'First block here.\n\nSecond block here.';
    const blocks = paragraphs(text);
    expect(blocks).toHaveLength(2);
    expect(text.slice(blocks[1]!.start, blocks[1]!.start + 6)).toBe('Second');
  });

  it('estimates syllables within tolerance', () => {
    expect(syllables('cat')).toBe(1);
    expect(syllables('table')).toBe(2);
    expect(syllables('little')).toBe(2);
    expect(syllables('simple')).toBe(2);
    expect(syllables('readability')).toBeGreaterThanOrEqual(4);
    expect(syllables('')).toBe(0);
  });
});

describe('readability consensus', () => {
  it('calls plain prose easy and dense prose hard', () => {
    const plain =
      'The dog ran fast. It was a good dog. We fed it. Then it slept by the fire. ' +
      'We were glad. The night was calm and the house was warm.';
    const dense =
      'The implementation of subsequent methodological considerations necessitates ' +
      'a comprehensive reevaluation of institutional epistemological frameworks, ' +
      'particularly insofar as such reconceptualizations demonstrably problematize ' +
      'previously uncontested organizational presuppositions.';

    expect(assess(plain).isHard).toBe(false);
    expect(assess(dense).isHard).toBe(true);
  });

  it('requires a majority of formulas to agree before flagging', () => {
    const verdict = assess('Short text here. It is fine.', 9);
    expect(verdict.grades).toHaveLength(7);
    expect(verdict.isHard).toBe(verdict.votesHarder >= 4);
  });

  it('handles empty input without dividing by zero', () => {
    const scores = score(collectStats(''));
    expect(Number.isFinite(scores.fleschKincaidGrade)).toBe(true);
    expect(scores.fleschReadingEase).toBe(100);
  });
});

describe('echo detection', () => {
  it('finds a repeated phrase and reports both positions', () => {
    const text =
      'At the end of the day we shipped it. The team was tired but happy about that. ' +
      'At the end of the day that is what counts.';
    const echoes = findEchoes(text, { minWords: 4 });

    expect(echoes.length).toBeGreaterThan(0);
    expect(echoes[0]!.phrase).toContain('end of the day');
    expect(echoes[0]!.positions.length).toBeGreaterThanOrEqual(2);
  });

  it('prefers the longest phrase over its substrings', () => {
    const text = 'the quick brown fox jumps here. and then the quick brown fox jumps again.';
    const echoes = findEchoes(text, { minWords: 3 });

    // "the quick brown fox jumps" should win over "the quick brown".
    expect(echoes[0]!.wordCount).toBeGreaterThanOrEqual(5);
  });

  it('reports a repeat longer than the window once, not as shifted copies', () => {
    // From a live doc: a 9-word repeat came back as two 8-word echoes,
    // "a comparative … form" and "comparative … form in".
    const phrase = 'a comparative analytical study of sonata allegro form in';
    const text = `My essay is ${phrase} dubstep. Next comes ${phrase} classical music.`;
    const echoes = findEchoes(text);

    expect(echoes).toHaveLength(1);
    expect(echoes[0]!.phrase).toBe('a comparative analytical study of sonata allegro form');
  });

  it('ignores repeats that are far apart', () => {
    // Filler must not repeat itself, or it becomes the echo under test.
    const filler = Array.from({ length: 90 }, (_, i) => `token${i} filler${i} word${i}`).join(' ');
    const text = `at the end of the day ${filler} at the end of the day`;
    expect(findEchoes(text, { minWords: 4, windowChars: 200 })).toHaveLength(0);
  });
});

describe('rhythm', () => {
  it('flags monotonous sentence length', () => {
    const monotone = Array.from(
      { length: 6 },
      (_, i) => `The team shipped the feature on time number ${i}.`,
    ).join(' ');
    expect(analyseRhythm(monotone).isMonotonous).toBe(true);
  });

  it('does not flag varied prose', () => {
    const varied =
      'Short. Then a considerably longer sentence arrives, carrying several clauses ' +
      'and a good deal more weight than the one before it. Brief again. And now another ' +
      'extended passage that stretches out across a fair number of words before stopping.';
    expect(analyseRhythm(varied).isMonotonous).toBe(false);
  });

  it('catches runs of identical sentence openers', () => {
    const text = 'Rivers carve the valley. Rivers remember the route. Rivers do not hurry.';
    const found = repeatedOpeners(text);
    expect(found[0]?.word).toBe('rivers');
    expect(found[0]?.count).toBe(3);
  });

  it('ignores articles as openers', () => {
    const text = 'The cat sat down. The dog barked loudly. The bird flew away.';
    expect(repeatedOpeners(text)).toHaveLength(0);
  });

  it('finds paragraphs far longer than the mean', () => {
    const text = `Short one.\n\n${'word '.repeat(200)}\n\nShort three.`;
    expect(analyseParagraphs(text).overlong).toContain(1);
  });
});

describe('style rules', () => {
  it('maps wordy phrases to their replacement', () => {
    const found = findWordy('We did it in order to ship due to the fact that time was short.');
    expect(found.map((f) => f.rule)).toEqual(['wordiness', 'wordiness']);
    expect(found.some((f) => f.message.includes('"to"'))).toBe(true);
  });

  it('detects regular and irregular passives', () => {
    expect(findPassive('The report was written by the team.')).toHaveLength(1);
    expect(findPassive('The bug was quickly fixed.')).toHaveLength(1);
  });

  it('flags buried subjects', () => {
    expect(findThereIs('There are three reasons this fails.')).toHaveLength(1);
    expect(findThereIs('Three reasons explain this failure.')).toHaveLength(0);
  });

  it('measures adverb density rather than flagging every adverb', () => {
    const clean = analyseAdverbs(`${'plain simple words here. '.repeat(20)}`);
    expect(clean.isHeavy).toBe(false);
  });

  it('returns findings in document order', () => {
    const text = 'It is important to note that we very quickly made a decision in order to move on.';
    const found = findStyleIssues(text);
    const starts = found.map((f) => f.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });
});

describe('review', () => {
  it('says nothing about a short fragment', () => {
    expect(review('Too short to judge.')).toHaveLength(0);
  });

  it('stays quiet on clean prose', () => {
    // The check that matters most. A reviewer that fires on good writing gets
    // muted on day two, and the field standard weights precision twice as
    // heavily as recall for exactly this reason.
    const clean =
      'The team shipped the release on Thursday. Adoption climbed through the weekend, ' +
      'faster than anyone had modelled. By Monday the support queue had doubled.\n\n' +
      'We cut the rollout to half of new accounts and watched the error rate settle. ' +
      'It held. Nobody had to page the on-call engineer, which was its own kind of win. ' +
      'The fix shipped quietly on Wednesday morning and the queue drained by lunch.';

    const findings = review(clean);
    expect(findings.map((f) => f.kind)).toEqual([]);
  });

  it('tags document-level findings so the policy defers them', () => {
    const repetitive = `${'At the end of the day we shipped it and the team went home happy. '.repeat(4)}`;
    const findings = review(repetitive);

    const echo = findings.find((f) => f.kind === 'echo');
    expect(echo).toBeDefined();
    // Document-relevant means it waits for a medium seam rather than firing at
    // the next fine one.
    expect(echo?.relevance).toBe(Relevance.Document);
  });

  it('orders findings by confidence', () => {
    const messy =
      'It should be noted that there are very many things which were done in order to ' +
      'make a decision about the thing. It should be noted that we were really quite ' +
      'happy about it. There are several reasons that this was basically fine.';

    const confidences = review(messy).map((f) => f.confidence);
    expect([...confidences].sort((a, b) => b - a)).toEqual(confidences);
  });

  it('names a reading band instead of a grade nobody recognises', () => {
    expect(readingLevel(48)).toBe('harder than college level');
    expect(readingLevel(14)).toBe('college reading level');
    expect(readingLevel(11)).toBe('about a grade 11 reading level');
  });

  it('does not repeat a quote the note already carries', () => {
    expect(styleNoteText('"the majority of" → "most"', 'The majority of', 1)).toBe('"the majority of" → "most"');
    expect(styleNoteText('"the majority of" → "most"', 'the majority of', 3)).toBe('"the majority of" → "most" — and 2 more');
    expect(styleNoteText('Hedge — cut it.', 'I believe', 1)).toBe('Hedge — cut it. ("I believe")');
  });

  it('collapses many instances of one rule into a single suggestion', () => {
    const text = `${'This was very very good and really really fine. '.repeat(8)}`;
    const weasels = review(text).filter((f) => f.kind === 'weasel');
    expect(weasels).toHaveLength(1);
  });
});
