import { describe, expect, it, vi } from 'vitest';
import { Renderer } from '../src/scheduler/Renderer';
import { SuggestionQueue } from '../src/scheduler/SuggestionQueue';
import { BreakpointDetector } from '../src/scheduler/BreakpointDetector';
import { Breakpoint, Relevance } from '../src/scheduler/types';

/** Minimal stand-ins — this is about the decision, not the animation. */
function harness(options: { minGapMs?: number } = {}) {
  const played: string[] = [];
  const said: string[] = [];

  const agent = {
    play: (name: string) => {
      played.push(name);
      return Promise.resolve();
    },
    speak: (text: string) => {
      said.push(text);
      return Promise.resolve();
    },
    balloon: { hide: vi.fn(), visible: false },
  } as unknown as import('../src/character/Agent').Agent;

  const queue = new SuggestionQueue();
  // Always quiet, so the silence floor never masks the gate under test.
  const detector = new BreakpointDetector({ minSilenceMs: 0 });
  const renderer = new Renderer(agent, queue, detector, options);

  const fire = (bp: Breakpoint): void => {
    // Drive the listener directly rather than synthesising DOM events.
    for (const listener of (detector as unknown as { listeners: Set<(b: Breakpoint) => void> })
      .listeners) {
      listener(bp);
    }
  };

  renderer.start();
  return { renderer, queue, detector, fire, said, played };
}

function candidate(kind: string) {
  return { kind, relevance: Relevance.Sentence, confidence: 0.9, text: `about ${kind}` };
}

describe('engagement gate', () => {
  it('says nothing while the user has the panel open', () => {
    // The bug this exists for: a proactive suggestion overwriting the balloon
    // the user is currently typing into.
    const { renderer, queue, fire, said } = harness({ minGapMs: 0 });
    queue.add(candidate('echo'));

    renderer.setEngaged(true);
    fire(Breakpoint.Fine);

    expect(said).toEqual([]);
    expect(queue.size).toBe(1); // held, not discarded
  });

  it('resumes once the user closes the panel', () => {
    const { renderer, queue, fire, said } = harness({ minGapMs: 0 });
    queue.add(candidate('echo'));

    renderer.setEngaged(true);
    fire(Breakpoint.Fine);
    renderer.setEngaged(false);
    fire(Breakpoint.Fine);

    expect(said).toHaveLength(1);
  });

  it('reports engagement so callers can branch on it', () => {
    const { renderer } = harness();
    expect(renderer.isEngaged).toBe(false);
    renderer.setEngaged(true);
    expect(renderer.isEngaged).toBe(true);
  });
});

describe('rate cap', () => {
  it('renders once, then holds the next one back', () => {
    const { queue, fire, said } = harness({ minGapMs: 600_000 });
    queue.add(candidate('echo'));
    queue.add(candidate('hedging'));

    fire(Breakpoint.Fine);
    fire(Breakpoint.Fine);

    expect(said).toHaveLength(1);
  });

  it('an explicit request ignores the cap entirely', () => {
    // The user asked. Neither the rate cap nor the silence floor applies to an
    // interruption they chose.
    const { renderer, queue, fire, said } = harness({ minGapMs: 600_000 });
    queue.add(candidate('echo'));
    fire(Breakpoint.Fine);

    renderer.showOnRequest('answering your question');

    expect(said).toHaveLength(2);
  });
});

describe('mute', () => {
  it('suppresses proactive rendering but not explicit requests', () => {
    const { renderer, queue, fire, said } = harness({ minGapMs: 0 });
    queue.add(candidate('echo'));

    renderer.setMuted(true);
    fire(Breakpoint.Fine);
    expect(said).toEqual([]);

    renderer.showOnRequest('you asked');
    expect(said).toHaveLength(1);
  });
});
