import { describe, expect, it, vi } from 'vitest';
import { ChatPanel, docTitleFrom, noteLabel, tallyLine } from '../src/content/chatPanel';
import type { DocumentEdit } from '../src/agent/types';
import { Balloon } from '../src/character/Balloon';

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
const labels = (root: HTMLElement) =>
  [...root.querySelectorAll('button')].map((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim());

describe('title ribbon', () => {
  it('has Settings and a close X, and no "Just let me write"', () => {
    const p = panel();
    const bar = p.handle;
    const visible = [...bar.querySelectorAll('button')].filter((b) => !b.hidden);
    expect(visible.map((b) => b.textContent)).toEqual(['Settings', '\u2715']);
    expect(labels(p.el).join('|')).not.toMatch(/just let me write|–/i);
  });

  it('the X closes the panel', () => {
    const onClose = vi.fn();
    const p = panel({ onClose });
    p.handle.querySelector<HTMLButtonElement>('.mrclippy-titlebtn-close')?.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Settings opens settings', () => {
    const onSettings = vi.fn();
    const p = panel({ onSettings });
    p.handle.querySelector<HTMLButtonElement>('.mrclippy-titlebtn-settings')?.click();
    expect(onSettings).toHaveBeenCalledTimes(1);
  });

  it('Escape anywhere in the panel closes it', () => {
    const onClose = vi.fn();
    const p = panel({ onClose });
    p.el.querySelector('.mrclippy-viewport')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('inside a thread it reads "< Notes" and the thread title, without Settings', async () => {
    const p = panel({ onAsk: async () => ({ text: 'ok' }) });
    const input = p.el.querySelector('textarea') as HTMLTextAreaElement;
    input.value = 'Is my thesis clear?';
    p.el.querySelector('form')?.requestSubmit();
    await flush();
    const back = p.el.querySelector<HTMLButtonElement>('.mrclippy-back');
    expect(back?.hidden).toBe(false);
    expect(back?.textContent).toBe('< Notes');
    expect(p.el.querySelector('.mrclippy-title')?.textContent).toBe('Is my thesis clear?');
    expect(p.el.querySelector<HTMLButtonElement>('.mrclippy-titlebtn-settings')?.hidden).toBe(true);
  });
});

describe('notes heading', () => {
  it('shows the count, the document and a tally', () => {
    const p = panel({
      findings: [
        { text: 'Hedge — the sentence is stronger without it.', anchor: 'I believe', kind: 'hedging' },
        { text: 'You use "x" 2 times close together.', anchor: 'x', kind: 'echo' },
      ],
      docTitle: 'Copy of Annotated Bibliography',
    });
    expect(p.el.querySelector('.mrclippy-big')?.textContent).toBe('2 notes');
    expect(p.el.querySelector('.mrclippy-sub')?.textContent).toContain('on Copy of Annotated Bibliography');
  });

  it('leaves the document line out when the title is unknown', () => {
    const p = panel({ findings: [{ text: 'A' }] });
    expect(p.el.querySelector('.mrclippy-big')?.textContent).toBe('1 note');
    expect(p.el.querySelector('.mrclippy-sub')?.textContent).not.toContain('on ');
  });

  it('strips the Google Docs suffix from the tab title', () => {
    expect(docTitleFrom('Copy of Essay - Google Docs')).toBe('Copy of Essay');
    expect(docTitleFrom('')).toBeUndefined();
    expect(docTitleFrom(' - Google Docs')).toBeUndefined();
  });

  it('lifts the label out of a style note and keeps the count', () => {
    expect(
      noteLabel({ text: 'Hedge — the sentence is stronger without it. — 3 instances, first: "I believe"', kind: 'hedging' }),
    ).toEqual({ label: 'Hedge', body: 'the sentence is stronger without it. 3 instances, first: "I believe"' });
    expect(noteLabel({ text: 'Paragraph 8 is long.', kind: 'paragraph-balance' })).toEqual({
      label: 'Long paragraph',
      body: 'Paragraph 8 is long.',
    });
  });
});

describe('tally line', () => {
  it('counts each state and leaves out the empty ones', () => {
    expect(
      tallyLine([
        { kind: 'ready', count: 2 },
        { kind: 'ready', count: 1 },
        { kind: 'ready', count: 3 },
        { kind: 'working' },
        { kind: 'applied' },
        { kind: 'failed' },
      ]),
    ).toBe('3 ready, 1 drafting, 1 applied, 1 failed');
    expect(tallyLine([{ kind: 'working' }, undefined])).toBe('1 drafting');
    expect(tallyLine([undefined])).toBe('');
  });

  it('follows the real threads: drafting, then ready, then failed', async () => {
    let fail = false;
    const p = panel({
      findings: [
        { text: 'A', anchor: 'one' },
        { text: 'B', anchor: 'two' },
      ],
      canEdit: true,
      prefetch: true,
      onAsk: async () => {
        if (fail) throw new Error('Claude could not reach the server.');
        fail = true;
        return { text: 'ok', proposals: [{ find: 'one', replace: '1' }] };
      },
    });
    const tally = () => p.el.querySelector('.mrclippy-tally')?.textContent;
    expect(tally()).toBe('1 drafting');
    for (let i = 0; i < 6; i++) await flush();
    expect(tally()).toBe('1 ready, 1 failed');
    const failed = p.el.querySelector('.mrclippy-nr[data-state="failed"]');
    expect(failed?.querySelector('.mrclippy-nr-st')?.textContent).toBe('Failed');
    expect(failed?.textContent).toContain('Not done. Claude could not reach the server.');
    expect(failed?.querySelector<HTMLButtonElement>('.mrclippy-retry')?.hidden).toBe(false);
  });
});

describe('hide fixed', () => {
  it('counts applied notes and answered questions, and hides them on tick', async () => {
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
    });
    for (let i = 0; i < 6; i++) await flush();
    const toggle = () => p.el.querySelector<HTMLButtonElement>('.mrclippy-notes-group .mrclippy-chk');
    expect(toggle()?.textContent).toBe('Hide fixed (0)');

    // One-click Apply straight from the list.
    p.el.querySelector<HTMLButtonElement>('.mrclippy-fix-apply')?.click();
    for (let i = 0; i < 4; i++) await flush();
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(p.el.querySelectorAll('.mrclippy-nr[data-fixed]')).toHaveLength(1);
    expect(toggle()?.textContent).toBe('Hide fixed (1)');

    toggle()?.click();
    expect(p.el.classList.contains('mrclippy-hide-fixed')).toBe(true);
    expect(toggle()?.getAttribute('aria-pressed')).toBe('true');
    expect(p.el.querySelector('.mrclippy-hidden-note')?.textContent).toBe('1 fixed item hidden. Untick to show it.');
    toggle()?.click();
    expect(p.el.classList.contains('mrclippy-hide-fixed')).toBe(false);
  });
});

describe('ask area', () => {
  it('keeps the chips under the Ask ribbon, above the input', () => {
    const p = panel();
    const area = p.el.querySelector('.mrclippy-ask-area');
    expect(area?.querySelector('.mrclippy-rib')?.textContent).toBe('Ask Mr. Clippy');
    const inner = area?.querySelector('.mrclippy-ask-in');
    expect(inner?.firstElementChild?.classList.contains('mrclippy-chips')).toBe(true);
    expect(inner?.lastElementChild?.tagName).toBe('FORM');
  });
});

describe('balloon sheet', () => {
  it('a suggestion carries a ribbon title and its buttons', () => {
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);
    const balloon = new Balloon(anchor);
    balloon.suggest('note', [{ label: 'Later', run: () => {} }], 'Mr. Clippy');
    expect(balloon.el.querySelector('.mrclippy-rib')?.textContent).toBe('Mr. Clippy');
    expect(balloon.el.dataset.sheet).toBe('');
    expect(balloon.el.querySelector('.mrclippy-balloon-tip svg')).not.toBeNull();
  });

  it('drops the sheet look for a plain line', () => {
    const anchor = document.createElement('div');
    const balloon = new Balloon(anchor);
    balloon.render(document.createElement('div'));
    balloon.hide();
    balloon.say('hello');
    expect(balloon.el.dataset.sheet).toBeUndefined();
  });
});

describe('thread titles and composer', () => {
  it('a fix thread is titled by its quoted passage when the note quotes it', async () => {
    const p = panel({
      findings: [{ text: 'Hedge — cut it. — 3 instances, first: "I believe"', anchor: 'I believe', kind: 'hedging' }],
      canEdit: true,
      onAsk: async () => ({ text: 'ok', proposals: [{ find: 'I believe', replace: '' }] }),
    });
    p.el.querySelector<HTMLButtonElement>('.mrclippy-review')?.click();
    await flush();
    expect(p.el.querySelector('.mrclippy-title')?.textContent).toBe('Hedge: "I believe"');
    expect(p.el.querySelector('.mrclippy-turn-user')?.textContent).toContain('Fix: Hedge: "I believe"');
    expect(p.el.querySelector('textarea')?.placeholder).toMatch(/this fix/);
  });

  it("a question's chat keeps the general placeholder and its row reports working", async () => {
    const p = panel({ onAsk: () => new Promise(() => {}) });
    const input = p.el.querySelector('textarea') as HTMLTextAreaElement;
    input.value = 'Be harsh';
    p.el.querySelector('form')?.requestSubmit();
    await flush();
    expect(input.placeholder).toBe('Ask a question, or tell me what to change…');
    p.el.querySelector<HTMLButtonElement>('.mrclippy-back')?.click();
    expect(p.el.querySelector('.mrclippy-q')?.getAttribute('data-state')).toBe('working');
  });
});
