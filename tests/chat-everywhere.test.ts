import { describe, expect, it, vi } from 'vitest';
import { ChatPanel, type AgentChange, type AgentReply } from '../src/content/chatPanel';
import { matchCommand } from '../src/content/localCommands';
import type { PanelState } from '../src/agent/panelTools';
import type { ChatTurn, DocumentEdit } from '../src/agent/types';

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await flush(); };

const FINDINGS = [
  { text: 'You use "drop" 3 times close together.', anchor: 'drop', kind: 'echo' },
  { text: 'Hedge — the sentence is stronger without it.', anchor: 'I believe', kind: 'hedging' },
];

/**
 * A panel whose drafts propose one edit per note, and whose typed questions
 * (the ones that carry the panel) get whatever reply the test queues.
 */
function setup(overrides: Partial<ConstructorParameters<typeof ChatPanel>[0]> = {}) {
  const replies: AgentReply[] = [];
  const onAsk = vi.fn(async (q: string, _h: readonly ChatTurn[], panel?: PanelState): Promise<AgentReply> => {
    if (panel) return replies.shift() ?? { text: 'A plain answer.' };
    return { text: 'draft', proposals: [{ find: q.includes('passage: "drop"') ? 'drop' : 'I believe', replace: 'x' }] };
  });
  const onApply = vi.fn(async (e: readonly DocumentEdit[]): Promise<AgentChange[]> => e.map((x) => ({ ...x, applied: true })));
  const onUndo = vi.fn(async () => 'Put it back the way it was.');
  const callbacks = {
    onSettings: vi.fn(), onClose: vi.fn(), onDismissFinding: vi.fn(),
    onSnooze: vi.fn(async () => undefined), onMute: vi.fn(async () => undefined),
  };
  const p = new ChatPanel({
    findings: FINDINGS, canEdit: true, prefetch: true,
    onAsk, onApply, onUndo, onAudit: async () => 'Holds up.', ...callbacks, ...overrides,
  });
  const type = async (text: string) => {
    const input = p.el.querySelector('textarea') as HTMLTextAreaElement;
    input.value = text;
    p.el.querySelector('form')?.requestSubmit();
    await settle();
  };
  const q = <T extends Element = HTMLElement>(sel: string) => p.el.querySelector(sel) as T | null;
  return { p, replies, onAsk, onApply, onUndo, type, q, ...callbacks };
}

const title = (p: ChatPanel) => p.el.querySelector('.mrclippy-title')?.textContent;
const said = (p: ChatPanel) => p.el.querySelector<HTMLElement>('.mrclippy-ask-reply');

/** The whole Ask box, visible and pinned at the foot of the panel body. */
function expectAskBox(p: ChatPanel): void {
  const area = p.el.querySelector<HTMLElement>('.mrclippy-ask-area');
  expect(area?.hidden).toBe(false);
  expect(area?.querySelector('.mrclippy-rib')?.textContent).toBe('Ask Clippee');
  expect(area?.querySelector<HTMLElement>('.mrclippy-chips')?.hidden).toBe(false);
  expect(area?.querySelector('textarea')).not.toBeNull();
  expect(area?.parentElement?.lastElementChild).toBe(area);
}

describe('the Ask box is on every screen', () => {
  it('on the notes, a fix thread, the Fix all result and a question thread', async () => {
    const { p, q, type } = setup();
    await settle();
    expectAskBox(p);

    q<HTMLButtonElement>('.mrclippy-review')?.click();
    await settle();
    expect(title(p)).toBe('Echo: "drop"');
    expectAskBox(p);

    q<HTMLButtonElement>('.mrclippy-back')?.click();
    q<HTMLButtonElement>('.mrclippy-fixall button')?.click();
    await settle();
    expect(title(p)).toBe('Fix all');
    expectAskBox(p);
    // Undo all stays pinned above the box, not replaced by it.
    expect(q('.mrclippy-foot')?.nextElementSibling).toBe(q('.mrclippy-ask-area'));

    await type('Is my thesis clear?');
    expect(title(p)).toBe('Is my thesis clear?');
    expectAskBox(p);
  });

  it('a question typed on the Fix all screen still opens its own chat', async () => {
    const { p, q, type } = setup();
    await settle();
    q<HTMLButtonElement>('.mrclippy-fixall button')?.click();
    await settle();
    await type('What did that change?');
    expect(title(p)).toBe('What did that change?');
    expect(p.el.textContent).toContain('A plain answer.');
    q<HTMLButtonElement>('.mrclippy-back')?.click();
    expect(q('.mrclippy-chats')?.textContent).toContain('What did that change?');
  });

  it('a chip in a fix thread starts a chat of its own', async () => {
    const { p, q, onAsk } = setup();
    await settle();
    q<HTMLButtonElement>('.mrclippy-review')?.click();
    [...p.el.querySelectorAll<HTMLButtonElement>('.mrclippy-chip')].find((b) => b.textContent === 'Sum it up')?.click();
    await settle();
    expect(title(p)).toBe('Sum it up');
    // Chips are fixed questions: no panel snapshot, no panel tools needed.
    expect(onAsk.mock.calls.at(-1)?.[2]).toBeUndefined();
  });
});

describe('he works his own panel from the chat', () => {
  it('sends what the panel shows with a typed question, and never with a draft', async () => {
    const { onAsk, type, replies } = setup();
    await settle();
    expect(onAsk.mock.calls.every((call) => call[2] === undefined)).toBe(true);
    replies.push({ text: 'Fine.' });
    await type('which one matters most?');
    const panel = onAsk.mock.calls.at(-1)?.[2];
    expect(panel).toMatchObject({
      screen: 'notes',
      fixAll: 'ready',
      hideDone: false,
      notes: [
        { number: 1, label: 'Echo', status: 'fix ready: 1 change' },
        { number: 2, label: 'Hedge', status: 'fix ready: 1 change' },
      ],
    });
  });

  it('"hid applied" on the Fix all screen ticks Hide applied and hides the applied rows', async () => {
    const { p, q, onAsk, replies, type } = setup();
    await settle();
    q<HTMLButtonElement>('.mrclippy-fixall button')?.click();
    await settle();
    const asked = onAsk.mock.calls.length;

    // Loose wording goes to him; his reply is an action, not an answer.
    replies.push({ text: '', actions: [{ action: 'hide_done' }] });
    await type('hid the applied ones pls');
    expect(onAsk.mock.calls.length).toBe(asked + 1);
    expect(onAsk.mock.calls.at(-1)?.[2]).toMatchObject({ screen: 'fix-all', hideDone: false });

    const toggle = q<HTMLButtonElement>('.mrclippy-receipt-screen .mrclippy-chk');
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
    expect(q('.mrclippy-receipt-screen')?.classList.contains('mrclippy-hide-fixed')).toBe(true);
    expect(q('.mrclippy-receipt-screen .mrclippy-hidden-note')?.textContent).toBe('2 applied changes hidden. Untick to show them.');
    // Still on the screen it was asked from, with one line saying what happened.
    expect(title(p)).toBe('Fix all');
    expect(said(p)?.hidden).toBe(false);
    expect(said(p)?.textContent).toBe('Hid 2 applied changes.');
    // A request is not a question: nothing new under "Your questions".
    expect(q('.mrclippy-chats')).toBeNull();
  });

  it('the exact command runs at once, typo and all, without asking him', async () => {
    const { p, q, onAsk, type } = setup();
    await settle();
    q<HTMLButtonElement>('.mrclippy-fixall button')?.click();
    await settle();
    const asked = onAsk.mock.calls.length;
    await type('hid applied');
    expect(onAsk.mock.calls.length).toBe(asked);
    expect(q('.mrclippy-receipt-screen .mrclippy-chk')?.getAttribute('aria-pressed')).toBe('true');
    expect(said(p)?.textContent).toBe('Hid 2 applied changes.');
    await type('show applied');
    expect(q('.mrclippy-receipt-screen .mrclippy-chk')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('fix all, then undo all, then redo, all from the chat', async () => {
    const { p, q, onApply, onUndo, replies, type } = setup();
    await settle();
    replies.push({ text: '', actions: [{ action: 'fix_all' }] });
    await type('just fix everything for me');
    expect(onApply).toHaveBeenCalledTimes(2);
    expect(title(p)).toBe('Fix all');
    expect(q('.mrclippy-receipt-screen .mrclippy-big')?.textContent).toBe('Applied 2 of 2');
    expect(said(p)?.textContent).toBe('Applied 2 of 2. Undo all is at the bottom.');

    replies.push({ text: '', actions: [{ action: 'undo_all' }] });
    await type('actually take it all back');
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect((onUndo.mock.calls[0] as unknown[])[0]).toHaveLength(2);
    const [undo, redo] = [...p.el.querySelectorAll<HTMLButtonElement>('.mrclippy-foot .mrclippy-btn')];
    expect(undo?.disabled).toBe(true);
    expect(redo?.disabled).toBe(false);
    expect(said(p)?.textContent).toBe('Took all 2 changes back out.');

    await type('redo');
    expect(onApply).toHaveBeenCalledTimes(3);
    expect(undo?.disabled).toBe(false);
  });

  it('ignores a note by number, and Fix all stops counting it', async () => {
    const { p, q, onDismissFinding, replies, type } = setup();
    await settle();
    replies.push({ text: '', actions: [{ action: 'ignore_note', note: 1 }] });
    await type('stop showing me the echo stuff');
    expect(onDismissFinding).toHaveBeenCalledWith(0);
    expect(p.el.querySelectorAll('.mrclippy-nr')).toHaveLength(1);
    expect(p.el.querySelector('.mrclippy-big')?.textContent).toBe('1 note');
    expect(q('.mrclippy-fixall:not(.mrclippy-needkey)')).toBeNull();
    expect(said(p)?.textContent).toBe("Ignored. I won't show Echo notes again.");
  });

  it('applies one note by name, and goes back to the notes', async () => {
    const { p, q, onApply, replies, type } = setup();
    await settle();
    replies.push({ text: '', actions: [{ action: 'apply', note: 2 }] });
    await type('fix the hedge one');
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]?.[0]).toEqual([{ find: 'I believe', replace: 'x' }]);
    const rows = p.el.querySelectorAll('.mrclippy-nr');
    expect(rows[1]?.getAttribute('data-state')).toBe('applied');
    expect(rows[0]?.getAttribute('data-state')).toBe('ready');
    expect(said(p)?.textContent).toBe('Applied the Hedge fix.');

    q<HTMLButtonElement>('.mrclippy-review')?.click();
    expect(title(p)).not.toBe('Clippee');
    replies.push({ text: '', actions: [{ action: 'back' }] });
    await type('nvm take me back');
    expect(title(p)).toBe('Clippee');
    expect(q<HTMLButtonElement>('.mrclippy-back')?.hidden).toBe(true);
    expect(said(p)?.textContent).toBe('Back to your notes.');
  });

  it('in a fix thread, "apply it" applies that fix and answers in the thread', async () => {
    const { p, q, onApply, replies, type } = setup();
    await settle();
    q<HTMLButtonElement>('.mrclippy-review')?.click();
    replies.push({ text: '', actions: [{ action: 'apply' }] });
    await type('ok apply it');
    expect(onApply.mock.calls[0]?.[0]).toEqual([{ find: 'drop', replace: 'x' }]);
    const turns = [...p.el.querySelectorAll('.mrclippy-turn-assistant')].map((t) => t.textContent);
    expect(turns.at(-1)).toBe('Applied the Echo fix.');
    expect(said(p)?.hidden).toBe(true);
    q<HTMLButtonElement>('.mrclippy-back')?.click();
    // The request did not leave the row reading "No change".
    expect(p.el.querySelector('.mrclippy-nr')?.getAttribute('data-state')).toBe('applied');
  });

  it('opens Settings, snoozes, mutes and closes', async () => {
    const { onSettings, onSnooze, onMute, onClose, replies, type } = setup();
    await settle();
    replies.push({ text: '', actions: [{ action: 'settings' }] });
    await type('where do i put my key');
    expect(onSettings).toHaveBeenCalledTimes(1);
    replies.push({ text: '', actions: [{ action: 'snooze', duration: '15m' }] });
    await type('be quiet for a bit');
    expect(onSnooze).toHaveBeenCalledWith('15m');
    await type('mute');
    expect(onMute).toHaveBeenCalledWith(true);
    await type('unmute');
    expect(onMute).toHaveBeenLastCalledWith(false);
    replies.push({ text: '', actions: [{ action: 'close' }] });
    await type('close this thing');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('answers in words when nothing in the panel matches', async () => {
    const { p, replies, type } = setup();
    await settle();
    replies.push({ text: 'Your thesis is in paragraph two.' });
    await type('where is my thesis');
    expect(title(p)).toBe('where is my thesis');
    expect(p.el.textContent).toContain('Your thesis is in paragraph two.');
  });
});

describe('local commands', () => {
  it('match exact commands, tidied, and one typo on longer ones', () => {
    expect(matchCommand('hid applied')).toEqual({ action: 'hide_done' });
    expect(matchCommand('Hide applied, please!')).toEqual({ action: 'hide_done' });
    expect(matchCommand('undo al')).toEqual({ action: 'undo_all' });
    expect(matchCommand('Go back')).toEqual({ action: 'back' });
    expect(matchCommand('snooze for an hour')).toEqual({ action: 'snooze', duration: '1h' });
  });

  it('leave everything else to him', () => {
    // Too short for a typo to be safe: "undo" and "redo" are one apart.
    expect(matchCommand('undi')).toBeUndefined();
    expect(matchCommand('apply the echo fix')).toBeUndefined();
    expect(matchCommand('is my thesis clear?')).toBeUndefined();
    expect(matchCommand('hide')).toBeUndefined();
  });
});
