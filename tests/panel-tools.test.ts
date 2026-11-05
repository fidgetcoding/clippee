import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelState } from '../src/agent/panelTools';

const KEY = 'sk-ant-test-never-leaves-the-worker';

const sdk = vi.hoisted(() => ({
  params: [] as Record<string, unknown>[],
  keys: [] as string[],
  reply: { content: [] as unknown[], stop_reason: 'end_turn' as string },
  listener: undefined as undefined | ((message: unknown, sender: object, reply: (v: unknown) => void) => boolean),
}));

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  class FakeAnthropic {
    readonly messages = {
      stream: (params: Record<string, unknown>) => {
        sdk.params.push(params);
        return { finalMessage: async () => sdk.reply };
      },
    };
    constructor(options: { apiKey: string }) {
      sdk.keys.push(options.apiKey);
    }
  }
  return { ...actual, default: FakeAnthropic };
});
vi.mock('../src/platform', () => ({ ext: {
  runtime: { onMessage: { addListener: (fn: typeof sdk.listener) => { sdk.listener = fn; } } },
} }));
vi.mock('../src/settings', () => ({ loadSettings: async () => ({ apiKey: KEY, workspaceId: '' }) }));

const { ask } = await import('../src/agent/client');
const { buildPanelBlock, isPanelState, parsePanelCall } = await import('../src/agent/panelTools');
await import('../src/background/serviceWorker');

const PANEL: PanelState = {
  screen: 'fix-all',
  title: 'Fix all',
  notes: [
    { number: 1, label: 'Echo', text: 'You use "drop" 3 times close together.', status: 'applied' },
    { number: 3, label: 'Readability', text: 'This sentence is hard to read.', status: 'failed: no reply' },
  ],
  questions: [{ number: 1, title: 'Is my thesis clear?', status: 'answered' }],
  hideDone: false,
  fixAll: 'done',
  canUndo: true,
  canRedo: false,
};

const base = { type: 'mrclippy:ask' as const, question: 'hid applied', document: 'Doc.', history: [], findings: [] };

const panelCall = (actions: unknown[]) => ({
  content: [{ type: 'tool_use', id: 't1', name: 'use_panel', input: { actions } }],
  stop_reason: 'tool_use',
});

beforeEach(() => {
  sdk.params.length = 0;
  sdk.reply = { content: [{ type: 'text', text: 'An answer.' }], stop_reason: 'end_turn' };
});

describe('the ask request', () => {
  it('carries the panel tool and the panel state, after the cached document', async () => {
    sdk.reply = panelCall([{ action: 'hide_done' }]);
    const response = await ask({ ...base, canEdit: true, panel: PANEL }, KEY);
    expect(response).toEqual({ ok: true, text: '', actions: [{ action: 'hide_done' }] });

    const params = sdk.params[0]!;
    expect(params.model).toBe('claude-opus-5-5');
    expect((params.tools as { name: string }[]).map((t) => t.name)).toEqual(['edit_document', 'use_panel']);
    expect(JSON.stringify(params.system)).toContain('use_panel');
    const messages = params.messages as { role: string; content: unknown }[];
    const last = messages.at(-1)!;
    expect(last.role).toBe('user');
    const [panelBlock, question] = last.content as { text: string }[];
    expect(panelBlock?.text).toContain('<panel>');
    expect(panelBlock?.text).toContain('Screen: the Fix all result screen');
    expect(panelBlock?.text).toContain('3. Readability. This sentence is hard to read. [failed: no reply]');
    expect(question?.text).toBe('hid applied');
    // The document block stays first and cached, so the snapshot never breaks it.
    expect(JSON.stringify(messages[0])).toContain('ephemeral');
  });

  it('sends the same tools and system with or without a panel, so drafts and chat share the cache', async () => {
    await ask({ ...base, canEdit: true }, KEY);
    await ask({ ...base, canEdit: true, panel: PANEL }, KEY);
    const [draft, typed] = sdk.params;
    expect(JSON.stringify(draft?.tools)).toBe(JSON.stringify(typed?.tools));
    expect(JSON.stringify(draft?.system)).toBe(JSON.stringify(typed?.system));
    expect(JSON.stringify((draft?.messages as unknown[])[0])).toBe(JSON.stringify((typed?.messages as unknown[])[0]));
    expect((draft?.messages as { content: unknown }[]).at(-1)?.content).toBe('hid applied');
  });

  it('gives the panel tool even where he cannot edit', async () => {
    await ask({ ...base, canEdit: false, panel: PANEL }, KEY);
    expect((sdk.params[0]?.tools as { name: string }[]).map((t) => t.name)).toEqual(['use_panel']);
  });

  it('ignores panel calls on a draft, which has no panel to work', async () => {
    sdk.reply = { content: [{ type: 'text', text: 'Hm.' }, ...panelCall([{ action: 'close' }]).content], stop_reason: 'tool_use' };
    expect(await ask({ ...base }, KEY)).toEqual({ ok: true, text: 'Hm.' });
  });

  it('drops malformed actions and keeps the good ones', () => {
    expect(parsePanelCall({ actions: [
      { action: 'apply', note: 2 }, { action: 'rm -rf' }, { action: 'snooze', duration: '3 weeks' },
      { action: 'ignore_note', note: 0 }, null, 'back',
    ] })).toEqual([{ action: 'apply', note: 2 }, { action: 'snooze' }, { action: 'ignore_note' }]);
    expect(parsePanelCall(undefined)).toEqual([]);
  });

  it('validates the snapshot at the worker boundary', () => {
    expect(isPanelState(PANEL)).toBe(true);
    expect(isPanelState({ ...PANEL, screen: 'settings' })).toBe(false);
    expect(isPanelState({ ...PANEL, notes: [{ number: 1, text: 'x', status: 'y' }] })).toBe(false);
    expect(buildPanelBlock({ ...PANEL, screen: 'notes', hideDone: true })).toContain('Hide fixed: on.');
  });
});

describe('the worker', () => {
  const send = (message: unknown) => new Promise<unknown>((resolve) => sdk.listener!(message, {}, resolve));

  it('runs the ask with the key it holds and hands back actions, never the key', async () => {
    sdk.reply = panelCall([{ action: 'hide_done' }, { action: 'undo_all' }]);
    const reply = await send({ ...base, canEdit: true, panel: PANEL });
    expect(reply).toEqual({ ok: true, text: '', actions: [{ action: 'hide_done' }, { action: 'undo_all' }] });
    expect(sdk.keys).toContain(KEY);
    expect(JSON.stringify(reply)).not.toContain(KEY);
    expect(sdk.params.at(-1)?.tools).toBeDefined();
  });

  it('refuses a malformed panel snapshot without calling Claude', async () => {
    const reply = await send({ ...base, panel: { screen: 'notes' } });
    expect(reply).toMatchObject({ ok: false });
    expect(sdk.params).toHaveLength(0);
  });

  it('never puts the key in an error the content script sees', async () => {
    sdk.reply = { content: [], stop_reason: 'end_turn' };
    const reply = await send({ ...base, panel: PANEL });
    expect(reply).toMatchObject({ ok: false });
    expect(JSON.stringify(reply)).not.toContain(KEY);
  });
});
