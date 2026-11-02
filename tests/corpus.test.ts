import { describe, expect, it } from 'vitest';
import { buildIdf, pathAffinity, rank, recencyBoost, terms, toPassages } from '../src/corpus/rank';
import type { CorpusDoc } from '../src/corpus/types';

const DAY = 24 * 60 * 60_000;
const NOW = Date.parse('2026-08-28T00:00:00Z');

function doc(
  id: string,
  title: string,
  path: string[],
  text: string,
  daysAgo = 1,
): CorpusDoc {
  return {
    id,
    title,
    path,
    text,
    modified: new Date(NOW - daysAgo * DAY).toISOString(),
  };
}

/** A small corpus with one obviously-relevant document and several distractors. */
const CORPUS: CorpusDoc[] = [
  doc(
    'harbour',
    'Tidewater — Harbour Notes',
    ['Tidewater', 'Worldbuilding'],
    'The lampwick is real harbour, not a field effect. Marisol loses the deck when the ' +
      'foghorn fires because the lampwick drops. Rain-boots are the only thing keeping ' +
      'anyone down. This matters for every storm sequence in the book.\n\n' +
      'Odile keeps her boots on. Bram does not, which is the whole point of his rowboat.',
  ),
  doc(
    'panel5',
    'Tidewater #5 — Panel Breakdown',
    ['Tidewater', 'Scripts'],
    'PANEL 3 ODILES HAND ON HER RAIN-BOOTS. She reaches down and switches them back on. ' +
      'She is the only human in the frame still touching the deck.\n\n' +
      'PANEL 4 BRAM JUST GOES UP. He can control his trajectory because of the rowboat.',
  ),
  doc(
    'recipes',
    'Sourdough Notes',
    ['Kitchen'],
    'The starter needs feeding twice a day in summer. Hydration around seventy per cent ' +
      'gives an open crumb. Bake with steam for the first twenty minutes, then vent.',
    400,
  ),
  doc(
    'invoice',
    'Invoice Template',
    ['Lorecraft', 'Admin'],
    'Remit to the account below within thirty days of receipt. Late payments accrue ' +
      'interest at the statutory rate. Please reference the invoice number on transfer.',
    200,
  ),
];

describe('term extraction', () => {
  it('drops stopwords and short tokens', () => {
    expect(terms('The lampwick is a real harbour effect')).toEqual([
      'lampwick',
      'real',
      'harbour',
      'effect',
    ]);
  });

  it('keeps hyphenated and possessive forms intact', () => {
    expect(terms('rain-boots and Odile’s deck')).toContain('rain-boots');
  });
});

describe('idf weighting', () => {
  it('scores a rare term above a common one', () => {
    // The whole reason for IDF: sharing "lampwick" (one document) means two
    // documents are about the same thing. Sharing "deck" (several) means less.
    const idf = buildIdf(CORPUS);
    expect(idf.get('lampwick')!).toBeGreaterThan(idf.get('deck')!);
  });
});

describe('path affinity', () => {
  it('scores a shared parent above an unrelated tree', () => {
    const near = pathAffinity(['Tidewater', 'Scripts'], ['Tidewater', 'Worldbuilding']);
    const far = pathAffinity(['Tidewater', 'Scripts'], ['Kitchen']);
    expect(near).toBeGreaterThan(far);
    expect(far).toBe(0);
  });

  it('scores an exact folder match highest', () => {
    expect(pathAffinity(['A', 'B'], ['A', 'B'])).toBe(1);
  });
});

describe('recency', () => {
  it('decays with a 180-day half-life', () => {
    expect(recencyBoost(new Date(NOW).toISOString(), NOW)).toBeCloseTo(1, 2);
    expect(recencyBoost(new Date(NOW - 180 * DAY).toISOString(), NOW)).toBeCloseTo(0.5, 2);
  });

  it('does not divide by an unparseable date', () => {
    expect(Number.isFinite(recencyBoost('not a date', NOW))).toBe(true);
  });
});

describe('passages', () => {
  it('splits on blank lines and keeps offsets', () => {
    const passages = toPassages(CORPUS[0]!);
    expect(passages.length).toBeGreaterThan(0);
    expect(passages[0]!.docId).toBe('harbour');
    expect(passages[0]!.title).toContain('Harbour');
  });

  it('drops a short block inside a longer document', () => {
    // A stray line between real paragraphs is a fragment, not a passage.
    const long =
      'A first paragraph with enough substance in it to clear the floor comfortably ' +
      'and then some more words after that.\n\nok\n\n' +
      'A third paragraph, also long enough to stand on its own as something worth ' +
      'retrieving later on.';
    const passages = toPassages(doc('x', 'X', [], long), 120);
    expect(passages.every((p) => p.text !== 'ok')).toBe(true);
  });

  it('keeps a whole document that is shorter than one passage', () => {
    // Otherwise short notes are silently invisible to the corpus.
    const passages = toPassages(doc('x', 'X', [], 'Lampwick is real harbour.'));
    expect(passages).toHaveLength(1);
    expect(passages[0]!.text).toBe('Lampwick is real harbour.');
  });

  it('yields nothing for an empty document', () => {
    expect(toPassages(doc('x', 'X', [], '   '))).toHaveLength(0);
  });
});

describe('retrieval', () => {
  const idf = buildIdf(CORPUS);

  it('finds the document that actually bears on the question', () => {
    const hits = rank(
      CORPUS,
      { text: 'why does the lampwick drop when the foghorn fires', currentDocId: 'panel5' },
      { idf, now: NOW },
    );
    expect(hits[0]?.docId).toBe('harbour');
  });

  it('never returns the document being written', () => {
    // Telling someone their document resembles itself is not insight.
    const hits = rank(
      CORPUS,
      { text: 'Odile rain-boots deck', currentDocId: 'panel5' },
      { idf, now: NOW },
    );
    expect(hits.map((h) => h.docId)).not.toContain('panel5');
  });

  it('returns at most one passage per document', () => {
    const hits = rank(CORPUS, { text: 'boots harbour deck rowboat' }, { idf, now: NOW });
    expect(new Set(hits.map((h) => h.docId)).size).toBe(hits.length);
  });

  it('explains why each result surfaced', () => {
    // A retrieval the user cannot account for reads as a hallucination.
    const hits = rank(
      CORPUS,
      {
        text: 'lampwick harbour',
        currentDocId: 'panel5',
        currentPath: ['Tidewater', 'Scripts'],
      },
      { idf, now: NOW },
    );
    expect(hits[0]!.reasons.some((r) => r.includes('lampwick'))).toBe(true);
    expect(hits[0]!.reasons).toContain('nearby folder');
  });

  it('prefers a sibling folder over an unrelated one at equal relevance', () => {
    const corpus: CorpusDoc[] = [
      doc('near', 'Near', ['Tidewater', 'Notes'], 'The lampwick holds the deck steady.'.repeat(4)),
      doc('far', 'Far', ['Kitchen'], 'The lampwick holds the deck steady.'.repeat(4)),
    ];
    const hits = rank(
      corpus,
      { text: 'lampwick deck', currentPath: ['Tidewater', 'Scripts'] },
      { idf: buildIdf(corpus), now: NOW },
    );
    expect(hits[0]?.docId).toBe('near');
  });

  it('stays silent rather than returning noise', () => {
    const hits = rank(CORPUS, { text: 'xylophone quarterly amortisation' }, { idf, now: NOW });
    expect(hits).toEqual([]);
  });

  it('ignores a query with no meaningful terms', () => {
    expect(rank(CORPUS, { text: 'the and of it' }, { idf, now: NOW })).toEqual([]);
  });

  it('does not let a long document win on volume alone', () => {
    const corpus: CorpusDoc[] = [
      doc(
        'short',
        'Short',
        [],
        'Lampwick harbour holds the deck. Rain-boots and the foghorn are what Marisol ' +
          'relies on when the field drops out from under the plate.',
      ),
      doc('long', 'Long', [], `${'Filler prose about nothing in particular. '.repeat(200)}lampwick`),
    ];
    const hits = rank(corpus, { text: 'lampwick harbour' }, { idf: buildIdf(corpus), now: NOW });
    expect(hits[0]?.docId).toBe('short');
  });

  it('retrieves a document too short to make a full passage', () => {
    // Short notes must not be silently invisible to the corpus.
    const corpus: CorpusDoc[] = [
      doc('note', 'Quick note', [], 'Lampwick is real harbour.'),
      doc('other', 'Other', [], `${'Unrelated prose about baking bread. '.repeat(30)}`),
    ];
    const hits = rank(corpus, { text: 'lampwick harbour' }, { idf: buildIdf(corpus), now: NOW });
    expect(hits[0]?.docId).toBe('note');
  });
});
