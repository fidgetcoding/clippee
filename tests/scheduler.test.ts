import { describe, expect, it } from 'vitest';
import { SuggestionQueue } from '../src/scheduler/SuggestionQueue';
import { Breakpoint, DISMISS_STRIKES, Relevance } from '../src/scheduler/types';

/** Controllable clock so TTL behaviour is testable without waiting. */
function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('relevance policy', () => {
  it('never fires a sentence-relevant suggestion at a coarse breakpoint', () => {
    // The counter-intuitive rule: a writer returning from another app is
    // deliberately switching context. Pulling them back with something relevant
    // to the sentence they left is the specific thing users disliked.
    const q = new SuggestionQueue();
    q.add({ kind: 'passive-voice', relevance: Relevance.Sentence, confidence: 1, text: 'x' });

    expect(q.drain(Breakpoint.Coarse)).toBeUndefined();
    expect(q.drain(Breakpoint.Fine)?.kind).toBe('passive-voice');
  });

  it('holds document-relevant suggestions for medium seams only', () => {
    const q = new SuggestionQueue();
    q.add({ kind: 'thesis-drift', relevance: Relevance.Document, confidence: 1, text: 'x' });

    expect(q.drain(Breakpoint.Fine)).toBeUndefined();
    expect(q.drain(Breakpoint.Coarse)).toBeUndefined();
    expect(q.drain(Breakpoint.Medium)?.kind).toBe('thesis-drift');
  });

  it('restricts general-interest suggestions to coarse seams', () => {
    const q = new SuggestionQueue();
    q.add({ kind: 'tip', relevance: Relevance.General, confidence: 1, text: 'x' });

    expect(q.drain(Breakpoint.Fine)).toBeUndefined();
    expect(q.drain(Breakpoint.Medium)).toBeUndefined();
    expect(q.drain(Breakpoint.Coarse)?.kind).toBe('tip');
  });
});

describe('time to live', () => {
  it('expires silently rather than downgrading to show anyway', () => {
    const c = clock();
    const q = new SuggestionQueue({ now: c.now });
    q.add({ kind: 'passive-voice', relevance: Relevance.Sentence, confidence: 1, text: 'x' });

    c.advance(89_000);
    expect(q.size).toBe(1);

    c.advance(2_000); // past the 90s sentence-class TTL
    expect(q.size).toBe(0);
    expect(q.drain(Breakpoint.Fine)).toBeUndefined();
  });

  it('does not extend an existing TTL when a duplicate arrives', () => {
    const c = clock();
    const q = new SuggestionQueue({ now: c.now });
    q.add({ kind: 'passive-voice', relevance: Relevance.Sentence, confidence: 0.5, text: 'first' });

    c.advance(80_000);
    q.add({ kind: 'passive-voice', relevance: Relevance.Sentence, confidence: 0.9, text: 'second' });

    // Higher confidence wins the slot...
    expect(q.peek()[0]?.text).toBe('second');

    // ...but the clock keeps running from the original queue time.
    c.advance(11_000);
    expect(q.size).toBe(0);
  });
});

describe('dismissal memory', () => {
  it('suppresses a kind after three dismissals', () => {
    // Clippy's canonical failure: the letter prompt re-fired no matter how many
    // times it was dismissed. Dismissals are counted by kind, not instance.
    const q = new SuggestionQueue();
    for (let i = 0; i < DISMISS_STRIKES; i++) q.dismiss('passive-voice');

    expect(q.isSuppressed('passive-voice')).toBe(true);
    expect(
      q.add({ kind: 'passive-voice', relevance: Relevance.Sentence, confidence: 1, text: 'x' }),
    ).toBeUndefined();
  });

  it('drops already-queued items of a kind the moment it is suppressed', () => {
    const q = new SuggestionQueue();
    q.add({ kind: 'adverbs', relevance: Relevance.Sentence, confidence: 1, text: 'x' });
    q.add({ kind: 'hedging', relevance: Relevance.Sentence, confidence: 1, text: 'y' });

    for (let i = 0; i < DISMISS_STRIKES; i++) q.dismiss('adverbs');

    expect(q.peek().map((s) => s.kind)).toEqual(['hedging']);
  });

  it('round-trips dismissal state for persistence across sessions', () => {
    const first = new SuggestionQueue();
    first.dismiss('adverbs');
    first.dismiss('adverbs');

    const second = new SuggestionQueue({ dismissals: first.dismissalState() });
    second.dismiss('adverbs');

    expect(second.isSuppressed('adverbs')).toBe(true);
  });
});

describe('ordering', () => {
  it('prefers confidence, then age', () => {
    const c = clock();
    const q = new SuggestionQueue({ now: c.now });

    q.add({ kind: 'a', relevance: Relevance.Sentence, confidence: 0.6, text: 'a' });
    c.advance(1_000);
    q.add({ kind: 'b', relevance: Relevance.Sentence, confidence: 0.9, text: 'b' });
    c.advance(1_000);
    q.add({ kind: 'c', relevance: Relevance.Sentence, confidence: 0.9, text: 'c' });

    // b and c tie on confidence; b was queued first.
    expect(q.drain(Breakpoint.Fine)?.kind).toBe('b');
    expect(q.drain(Breakpoint.Fine)?.kind).toBe('c');
    expect(q.drain(Breakpoint.Fine)?.kind).toBe('a');
  });
});
