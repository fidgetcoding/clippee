import { describe, expect, it, vi } from 'vitest';
import { review, spanOfWords } from '../src/checks';
import { ChatPanel, fixQuestion, type AgentChange } from '../src/content/chatPanel';
import type { DocumentEdit } from '../src/agent/types';

const essay =
  'At the end of the day the band plays loud. I believe the drop matters most. ' +
  'At the end of the day the crowd wants the drop. Very many producers agree with this. ' +
  'The majority of tracks follow the same shape, and the shape is sonata form in disguise. ' +
  'The build leads to the drop and the drop leads back to the theme again and again.';

function panel(overrides: Partial<ConstructorParameters<typeof ChatPanel>[0]> = {}) {
  return new ChatPanel({
    findings: [],
    onAsk: async () => ({ text: '' }),
    onAudit: async () => '',
    onDismissFinding: () => {},
    onClose: () => {},
    onSettings: () => {},
    ...overrides,
  });
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('finding anchors', () => {
  it('every anchor is verbatim text from the document', () => {
    const anchored = review(essay).filter((f) => f.anchor);
    expect(anchored.length).toBeGreaterThan(0);
    for (const f of anchored) expect(essay).toContain(f.anchor);
  });

  it('reading level points at the hardest sentence, not a grade number', async () => {
    const { hardestSentence } = await import('../src/checks');
    const text =
      'The cat sat on the mat and looked out the window at the birds all day. ' +
      'Notwithstanding considerable methodological heterogeneity, contemporaneous electronic compositional paradigms systematically appropriate sonata-allegro architectonics, fundamentally reconfiguring expositional, developmental, and recapitulatory functionalities. ' +
      'Then it went to sleep in the sun for a while and was happy.';
    const worst = hardestSentence(text);
    expect(worst?.text).toContain('Notwithstanding');
  });

  it('no longer emits the two notes that pointed at nothing', () => {
    const flat = Array.from({ length: 12 }, () => 'The band plays the same song every night now.').join(' ');
    const kinds = review(`${flat} Really quickly, truly, sadly, madly, badly.`).map((f) => f.kind);
    expect(kinds).not.toContain('monotonous-rhythm');
    expect(kinds).not.toContain('adverb-density');
  });

  it('spanOfWords keeps the original spacing and case', () => {
    expect(spanOfWords('Hello,  big World here', 0, 3)).toBe('Hello,  big World');
  });
});

describe('one fix at a time', () => {
  it('Fix asks about that finding only', () => {
    const q = fixQuestion({ text: 'Hedge', anchor: 'I believe' });
    expect(q).toContain('Fix only this one issue');
    expect(q).toContain('"I believe"');
  });

  it('shows proposals without applying them, then applies only the one picked', async () => {
    const edits: DocumentEdit[] = [
      { find: 'The majority of', replace: 'Most' },
      { find: 'Very many', replace: 'Many' },
    ];
    const onApply = vi.fn(
      async (picked: readonly DocumentEdit[]): Promise<AgentChange[]> =>
        picked.map((e) => ({ ...e, applied: true })),
    );
    const p = panel({
      findings: [{ text: 'Wordy', anchor: 'The majority of' }],
      canEdit: true,
      onAsk: async () => ({ text: 'Two cuts.', proposals: edits }),
      onApply,
    });
    document.body.appendChild(p.el);

    p.el.querySelector<HTMLButtonElement>('.mrclippy-review')?.click();
    await flush();
    await flush();

    const rows = p.el.querySelectorAll('.mrclippy-proposal');
    expect(rows).toHaveLength(2);
    expect(onApply).not.toHaveBeenCalled();

    // Skip the first, apply the second.
    rows[0]?.querySelector<HTMLButtonElement>('.mrclippy-btn:not(.mrclippy-btn-primary)')?.click();
    rows[1]?.querySelector<HTMLButtonElement>('.mrclippy-btn-primary')?.click();
    await flush();

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]?.[0]).toEqual([edits[1]]);
  });

  it('each Fix gets its own thread, and the list keeps the others', async () => {
    let n = 0;
    const p = panel({
      findings: [
        { text: 'Hedge', anchor: 'I believe' },
        { text: 'Wordy', anchor: 'The majority of' },
      ],
      canEdit: true,
      onAsk: async () => ({ text: `reply ${++n}`, proposals: [{ find: 'a', replace: 'b' }] }),
      onApply: async (e) => e.map((x) => ({ ...x, applied: true })),
    });
    const fixes = () => p.el.querySelectorAll<HTMLButtonElement>('.mrclippy-review');
    const back = () => p.el.querySelector<HTMLButtonElement>('.mrclippy-back');

    fixes()[0]?.click();
    await flush();
    await flush();
    // Inside thread 1: one proposal, a back button, and not the list.
    expect(p.el.querySelectorAll('.mrclippy-proposal')).toHaveLength(1);
    expect(back()?.hidden).toBe(false);
    expect(p.el.querySelector('.mrclippy-findings')).toBeNull();

    back()?.click();
    expect(p.el.querySelector('.mrclippy-findings')).not.toBeNull();
    expect(p.el.querySelector('.mrclippy-nr-st')?.textContent).toBe('1 change');

    fixes()[1]?.click();
    await flush();
    await flush();
    expect(p.el.textContent).toContain('reply 2');
    expect(p.el.textContent).not.toContain('reply 1');

    // Going back into the first fix does not ask again.
    back()?.click();
    fixes()[0]?.click();
    await flush();
    expect(n).toBe(2);
    expect(p.el.textContent).toContain('reply 1');
  });

  it('a paragraph split shows as a marked break, not the same text twice', async () => {
    const { diffParts } = await import('../src/content/diffView');
    const d = diffParts('in the industry. I bring', 'in the industry.\nI bring');
    expect(d.removed.trim()).toBe('');
    expect(d.added).toContain('\n');
  });

  it('renders the split as a new-paragraph marker with no empty strike', async () => {
    const { renderDiff } = await import('../src/content/diffView');
    const el = renderDiff('in the industry. I bring', 'in the industry.\nI bring');
    expect(el.querySelector('del')).toBeNull();
    expect(el.querySelector('.mrclippy-diff-break')?.textContent).toContain('new paragraph');
  });

  it('Undo flips to Redo, and Redo puts the change back', async () => {
    const onUndo = vi.fn(async () => 'Put it back the way it was.');
    const onApply = vi.fn(async (e: readonly DocumentEdit[]) => e.map((x) => ({ ...x, applied: true })));
    const p = panel({
      onAsk: async () => ({ text: 'ok', proposals: [{ find: 'old', replace: 'new' }] }),
      onApply,
      onUndo,
    });
    const input = p.el.querySelector('textarea') as HTMLTextAreaElement;
    input.value = 'change it';
    p.el.querySelector('form')?.requestSubmit();
    await flush();
    await flush();
    p.el.querySelector<HTMLButtonElement>('.mrclippy-proposal .mrclippy-btn-primary')?.click();
    await flush();

    const toggle = () =>
      [...p.el.querySelectorAll<HTMLButtonElement>('.mrclippy-receipt .mrclippy-btn')].at(-1);
    expect(toggle()?.textContent).toBe('Undo');
    toggle()?.click();
    await flush();
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(toggle()?.textContent).toBe('Redo');
    toggle()?.click();
    await flush();
    expect(onApply).toHaveBeenCalledTimes(2);
    expect(toggle()?.textContent).toBe('Undo');
  });

  it('Fix all says what it will do, then applies every drafted fix with one Undo', async () => {
    const onApply = vi.fn(async (e: readonly DocumentEdit[]) => e.map((x) => ({ ...x, applied: true })));
    let n = 0;
    const p = panel({
      findings: [
        { text: 'A', anchor: 'one' },
        { text: 'B', anchor: 'two' },
      ],
      canEdit: true,
      prefetch: true,
      onAsk: async () => ({ text: 'ok', proposals: [{ find: `f${++n}`, replace: 'r' }] }),
      onApply,
      onUndo: async () => 'undone',
    });
    const bar = p.el.querySelector('.mrclippy-fixall');
    expect(bar?.textContent).toContain('Applies all 2 fixes');

    bar?.querySelector<HTMLButtonElement>('button')?.click();
    for (let i = 0; i < 6; i++) await flush();

    expect(onApply).toHaveBeenCalledTimes(2);
    // The result is a screen of its own, with one Undo all at its foot.
    expect(p.el.querySelector('.mrclippy-receipt-screen .mrclippy-big')?.textContent).toBe('Applied 2 of 2');
    expect(p.el.querySelector('.mrclippy-title')?.textContent).toBe('Fix all');
    const foot = [...p.el.querySelectorAll<HTMLButtonElement>('.mrclippy-foot .mrclippy-btn')];
    expect(foot.map((b) => b.textContent)).toEqual(['Undo all', 'Redo']);
    expect(foot[1]?.disabled).toBe(true);

    // Back on the notes, both rows read Applied and the tally says so.
    p.el.querySelector<HTMLButtonElement>('.mrclippy-back')?.click();
    expect(p.el.querySelector('.mrclippy-tally')?.textContent).toBe('2 of 2 applied');
  });

  it('a question asked from the list opens its own chat, listed for later', async () => {
    const p = panel({ onAsk: async (q) => ({ text: `answer to ${q}` }) });
    const input = p.el.querySelector('textarea') as HTMLTextAreaElement;
    input.value = 'is my thesis clear?';
    p.el.querySelector('form')?.requestSubmit();
    await flush();
    await flush();
    expect(p.el.querySelector<HTMLButtonElement>('.mrclippy-back')?.hidden).toBe(false);
    expect(p.el.textContent).toContain('answer to is my thesis clear?');

    p.el.querySelector<HTMLButtonElement>('.mrclippy-back')?.click();
    expect(p.el.querySelector('.mrclippy-chats')?.textContent).toContain('is my thesis clear?');
    expect(p.el.textContent).not.toContain('answer to');
  });

  it('hovering a finding selects its passage in the document', async () => {
    vi.useFakeTimers();
    const onLocate = vi.fn();
    const p = panel({ findings: [{ text: 'Hedge', anchor: 'I believe' }], onLocate });
    p.el.querySelector('.mrclippy-finding')?.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(300);
    expect(onLocate).toHaveBeenCalledWith('I believe');
    vi.useRealTimers();
  });
});

describe('panel disposal', () => {
  it('stops queued prefetch and hover work after closing', async () => {
    let finish!: (reply: { text: string }) => void;
    const onAsk = vi.fn(() => new Promise<{ text: string }>((resolve) => { finish = resolve; }));
    const onLocate = vi.fn();
    const p = panel({
      findings: [{ text: 'First', anchor: 'first' }, { text: 'Second', anchor: 'second' }],
      prefetch: true, onAsk, onLocate,
    });
    p.el.querySelector('.mrclippy-finding')?.dispatchEvent(new MouseEvent('mouseenter'));
    expect(onAsk).toHaveBeenCalledTimes(1);
    p.dispose();
    finish({ text: 'Late reply' });
    await flush();
    await flush();
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onLocate).not.toHaveBeenCalled();
    expect(p.el.textContent).not.toContain('Late reply');
  });
});
