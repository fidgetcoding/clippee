import { describe, expect, it } from 'vitest';
import {
  analyseBalance,
  findPromises,
  looksLikeHeading,
  outline,
  structureSignals,
} from '../src/checks/structure';

describe('heading detection', () => {
  it('accepts the shapes real headings take', () => {
    expect(looksLikeHeading('PANEL 2 THE DUST WING GOES UP')).toBe(true);
    expect(looksLikeHeading('The Harbour Stack')).toBe(true);
    expect(looksLikeHeading('3. Why This Matters')).toBe(true);
    expect(looksLikeHeading('PAGE 14 — ENTRY / O2')).toBe(true);
  });

  it('rejects ordinary sentences', () => {
    // A false heading fragments the document and every downstream measure
    // inherits the error, so this has to stay strict.
    expect(looksLikeHeading('The lampwick is real harbour, not a field effect.')).toBe(false);
    expect(looksLikeHeading('She reaches down and switches them back on.')).toBe(false);
    expect(looksLikeHeading('')).toBe(false);
  });

  it('rejects a long line even when title-cased', () => {
    expect(
      looksLikeHeading(
        'The Complete And Exhaustive Account Of Everything That Happened On The Deck That Day',
      ),
    ).toBe(false);
  });

  it('rejects a short line that ends in punctuation', () => {
    expect(looksLikeHeading('The Harbour Stack.')).toBe(false);
  });
});

describe('outline', () => {
  const DOC = [
    'THE HARBOUR STACK',
    '',
    'The lampwick is real harbour. It holds everyone to the deck until the foghorn fires.',
    '',
    'RAIN-BOOTS',
    '',
    'Odile keeps hers on. Bram does not, which is the whole point of the rowboat.',
    '',
    'THE FOGHORN',
    '',
    'One device, one effect. It drops the lampwick inside a fixed radius.',
  ].join('\n');

  it('splits on headings and counts each section', () => {
    const sections = outline(DOC);
    expect(sections.map((s) => s.heading)).toEqual([
      'THE HARBOUR STACK',
      'RAIN-BOOTS',
      'THE FOGHORN',
    ]);
    expect(sections[0]!.wordCount).toBeGreaterThan(5);
  });

  it('keeps heading offsets so a finding can point at one', () => {
    const sections = outline(DOC);
    expect(DOC.slice(sections[1]!.start, sections[1]!.start + 10)).toBe('RAIN-BOOTS');
  });

  it('returns nothing for a document with no headings', () => {
    expect(outline('Just prose. More prose. Nothing that looks like a heading here.')).toEqual([]);
  });
});

describe('promises', () => {
  it('reads an enumerated count from the opening', () => {
    const found = findPromises(
      'This piece covers three things about the lampwick. It matters because the whole ' +
        'second act depends on it.',
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.count).toBe(3);
  });

  it('handles a numeral as well as a word', () => {
    expect(findPromises('There are 4 reasons this fails.')[0]?.count).toBe(4);
  });

  it('picks up a colon list as the enumeration', () => {
    const found = findPromises('This covers: harbour, boots, and the foghorn.');
    expect(found[0]!.items).toEqual(['harbour', 'boots', 'the foghorn']);
  });

  it('catches a forward commitment with no count', () => {
    const found = findPromises("Below I'll walk through how the lampwick actually works.");
    expect(found).toHaveLength(1);
    expect(found[0]!.count).toBeUndefined();
  });

  it('ignores a promise made at the end of a long document', () => {
    // A commitment in the last paragraph is a summary, not a promise.
    const doc = `${'Filler sentence about nothing. '.repeat(200)}This covers three things.`;
    expect(findPromises(doc)).toHaveLength(0);
  });

  it('stays quiet on prose that commits to nothing', () => {
    expect(
      findPromises('The lampwick is real harbour. Rain-boots are the only thing keeping anyone down.'),
    ).toEqual([]);
  });
});

describe('balance', () => {
  it('flags a section far longer than its siblings', () => {
    const doc = [
      'FIRST',
      'short body here with a few words in it',
      'SECOND',
      `${'word '.repeat(400)}`,
      'THIRD',
      'also short body text',
    ].join('\n');

    const report = analyseBalance(doc);
    expect(report.bloated.map((s) => s.heading)).toContain('SECOND');
  });

  it('says nothing about a document with too few sections to compare', () => {
    const report = analyseBalance('ONLY ONE\nsome body text goes here');
    expect(report.bloated).toEqual([]);
    expect(report.meanWords).toBe(0);
  });
});

describe('structure signals', () => {
  const LONG_PROMISE = [
    'THE HARBOUR STACK',
    '',
    'This document covers three things: how the lampwick works, what the foghorn does, ' +
      'and why the rain-boots matter. Each one is load-bearing for the second act and ' +
      'none of them are explained anywhere else in the series bible.',
    '',
    'HOW THE LAMPWICK WORKS',
    '',
    `${'The lampwick is real harbour rather than a field effect. '.repeat(20)}`,
    '',
    'WHAT THE FOGHORN DOES',
    '',
    `${'The foghorn drops the lampwick inside a fixed radius. '.repeat(20)}`,
  ].join('\n');

  it('raises a candidate when the opening promises a count', () => {
    const signals = structureSignals(LONG_PROMISE);
    const promise = signals.find((s) => s.kind === 'promise');
    expect(promise).toBeDefined();
    // It reports the shape; it does not decide whether the promise was kept.
    expect(promise!.detail).toContain('3');
    expect(promise!.evidence.length).toBeGreaterThan(1);
  });

  it('carries the section headings as evidence for the model', () => {
    const promise = structureSignals(LONG_PROMISE).find((s) => s.kind === 'promise');
    expect(promise!.evidence).toContain('HOW THE LAMPWICK WORKS');
    expect(promise!.evidence).toContain('WHAT THE FOGHORN DOES');
  });

  it('stays silent on a document too short to have structure', () => {
    expect(structureSignals('Three short sentences. That is all. Nothing more.')).toEqual([]);
  });

  it('notices a long document with no headings at all', () => {
    // Has to clear the 300-word floor, or the short-document guard fires first.
    const doc = `${'A paragraph of ordinary prose that says something worth saying at some length here.\n\n'.repeat(30)}`;
    const signals = structureSignals(doc);
    expect(signals.some((s) => s.kind === 'no-structure')).toBe(true);
  });

  it('produces candidates, never verdicts', () => {
    // The local pass must not claim a promise was broken — only that one exists
    // and is worth a model call. That separation is the whole ladder.
    for (const signal of structureSignals(LONG_PROMISE)) {
      expect(signal.detail).not.toMatch(/\b(?:failed|broken|missing|never delivered)\b/i);
    }
  });
});
