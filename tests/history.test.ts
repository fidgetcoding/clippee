import { afterEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock('../src/platform', () => ({
  hasExtensionApis: () => true,
  ext: {
    storage: {
      local: {
        get: async (key: string) => (key in store.data ? { [key]: structuredClone(store.data[key]) } : {}),
        set: async (items: Record<string, unknown>) => { Object.assign(store.data, structuredClone(items)); },
        remove: async (key: string) => { delete store.data[key]; },
      },
      onChanged: { addListener: () => undefined, removeListener: () => undefined },
    },
    runtime: { sendMessage: async () => undefined },
  },
}));

import type { DocumentEdit } from '../src/agent/types';
import { ChatPanel } from '../src/content/chatPanel';
import { DocEdits } from '../src/content/docEdits';
import { HISTORY_MAX_AGE_MS, HISTORY_MAX_ENTRIES, historyKey, trim, type HistoryEntry } from '../src/content/docHistory';
import type { DocumentSource } from '../src/content/documentSource';
import { FieldEditor } from '../src/content/fieldEditor';
import { ago } from '../src/content/historyView';
import { matchCommand } from '../src/content/localCommands';

const URL_A = 'https://docs.google.com/document/d/abc123_XYZ/edit?tab=t.0';
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  store.data = {};
  document.body.replaceChildren();
});

/** A text field standing in for the doc: the same source shape Docs has. */
function doc(text: string) {
  const area = document.createElement('textarea');
  area.value = text;
  document.body.append(area);
  const field = new FieldEditor();
  area.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  const source: DocumentSource = {
    id: 'test', matches: () => true, read: async () => field.read(), canEdit: () => field.active,
    context: () => field.identity,
    replace: async (find, value, near) => field.replace(find, value, near),
    select: async () => false, boxes: () => [],
  };
  return { area, source, context: field.identity };
}

const saved = (): HistoryEntry[] => (store.data[historyKey(URL_A)] as { entries: HistoryEntry[] } | undefined)?.entries ?? [];

describe('the History key', () => {
  it('is the Docs document id, whatever else is in the URL', () => {
    expect(historyKey(URL_A)).toBe(historyKey('https://docs.google.com/document/d/abc123_XYZ/edit#heading=h.1'));
    expect(historyKey(URL_A)).toBe('mrclippy:history:docs:abc123_XYZ');
    expect(historyKey('https://docs.google.com/document/d/other/edit')).not.toBe(historyKey(URL_A));
  });
});

describe('recording', () => {
  it('records every edit with where it came from: a fix, Fix all, or the Ask box', async () => {
    const d = doc('one old two stale three tired');
    const edits = new DocEdits(d.source, URL_A);
    await edits.apply([{ find: 'old', replace: 'new' }], d.context, 'Wordy: "old"');
    await edits.apply([{ find: 'stale', replace: 'fresh' }], d.context, 'Fix all');
    await edits.apply([{ find: 'tired', replace: 'rested' }], d.context, 'Asked: Tighten this');
    await vi.waitFor(() => expect(saved()).toHaveLength(3));
    expect(saved().map((e) => [e.origin, e.find, e.replace, e.state])).toEqual([
      ['Asked: Tighten this', 'tired', 'rested', 'applied'],
      ['Fix all', 'stale', 'fresh', 'applied'],
      ['Wordy: "old"', 'old', 'new', 'applied'],
    ]);
    // A few words either side, to find it again later. Never the whole doc.
    expect(saved()[2]!.anchor).toEqual({ prefix: 'one ', suffix: ' two stale three tired' });
    edits.dispose();
  });

  it('records Undo and Redo from a receipt too', async () => {
    const d = doc('one old two');
    const edits = new DocEdits(d.source, URL_A);
    const changes = await edits.apply([{ find: 'old', replace: 'new' }], d.context, 'Fix');
    await edits.undo(changes);
    await vi.waitFor(() => expect(saved()[0]?.state).toBe('undone'));
    await edits.redo(changes, d.context);
    await vi.waitFor(() => expect(saved()[0]?.state).toBe('applied'));
    expect(d.area.value).toBe('one new two');
    edits.dispose();
  });

  it('keeps 200 entries and 30 days, whichever is fewer', () => {
    const now = 1_000_000_000_000;
    const entry = (i: number, at: number): HistoryEntry => ({
      id: `e${i}`, batch: `b${i}`, at, origin: 'Fix', find: 'a', replace: 'b', state: 'applied',
    });
    const many = Array.from({ length: 250 }, (_, i) => entry(i, now - i * 1000));
    expect(trim(many, now)).toHaveLength(HISTORY_MAX_ENTRIES);
    expect(trim(many, now)[0]!.id).toBe('e0');
    const old = [entry(1, now - HISTORY_MAX_AGE_MS - 1), entry(2, now - 5)];
    expect(trim(old, now).map((e) => e.id)).toEqual(['e2']);
  });
});

describe('undo from the History', () => {
  it('survives a reload: a fresh page undoes and redoes by the words around each change', async () => {
    const d = doc('Alpha old beta. Gamma stale delta.');
    const first = new DocEdits(d.source, URL_A);
    await first.apply([{ find: 'old', replace: 'new' }], d.context, 'Fix one');
    await first.apply([{ find: 'stale', replace: 'fresh' }], d.context, 'Fix two');
    await vi.waitFor(() => expect(saved()).toHaveLength(2));
    first.dispose();

    // The page reloads: no receipts, no in-memory records, only storage.
    const second = new DocEdits(d.source, URL_A);
    const entries = await second.history.list();
    expect(entries.map((e) => e.origin)).toEqual(['Fix two', 'Fix one']);
    const out = await second.history.undo(entries.map((e) => e.id));
    expect([...out.values()]).toEqual(['done', 'done']);
    expect(d.area.value).toBe('Alpha old beta. Gamma stale delta.');
    expect((await second.history.list()).every((e) => e.state === 'undone')).toBe(true);

    await second.history.redo(entries.map((e) => e.id));
    expect(d.area.value).toBe('Alpha new beta. Gamma fresh delta.');
    second.dispose();
  });

  it('refuses when the text changed since, and leaves the doc exactly as it is', async () => {
    const d = doc('Keep this old phrase here.');
    const edits = new DocEdits(d.source, URL_A);
    await edits.apply([{ find: 'old', replace: 'new' }], d.context, 'Fix');
    await vi.waitFor(() => expect(saved()).toHaveLength(1));
    d.area.value = 'Keep this new phrase over there.'; // The writer kept going.
    const [entry] = await edits.history.list();
    const out = await edits.history.undo([entry!.id]);
    expect(out.get(entry!.id)).toBe('changed');
    expect(d.area.value).toBe('Keep this new phrase over there.');
    expect((await edits.history.list())[0]!.state).toBe('applied');
    edits.dispose();
  });

  it('undoes an older fix after a later one changed the doc elsewhere', async () => {
    const d = doc('First paragraph says old things, and goes on for a good while after that.\n\nThe second one is stale.');
    const edits = new DocEdits(d.source, URL_A);
    const older = await edits.apply([{ find: 'old', replace: 'new' }], d.context, 'Fix one');
    await edits.apply([{ find: 'stale', replace: 'fresh' }], d.context, 'Fix two');
    // The receipt's own Undo, a fix ago: still goes, because its own words are untouched.
    await edits.undo(older);
    expect(d.area.value).toBe('First paragraph says old things, and goes on for a good while after that.\n\nThe second one is fresh.');
    edits.dispose();
  });

  it('clears the list, never the doc', async () => {
    const d = doc('one old two');
    const edits = new DocEdits(d.source, URL_A);
    await edits.apply([{ find: 'old', replace: 'new' }], d.context, 'Fix');
    await vi.waitFor(() => expect(saved()).toHaveLength(1));
    await edits.history.clear();
    expect(await edits.history.list()).toEqual([]);
    expect(d.area.value).toBe('one new two');
    edits.dispose();
  });
});

/** A panel over a real DocEdits, with one finding whose fix is drafted. */
function panelOver(text: string, edit: DocumentEdit) {
  const d = doc(text);
  const edits = new DocEdits(d.source, URL_A);
  const p = new ChatPanel({
    findings: [{ text: `Wordy. "${edit.find}"`, anchor: edit.find, kind: 'wordiness' }],
    canEdit: true,
    prefetch: true,
    onAsk: async () => ({ text: 'One cut.', proposals: [edit] }),
    onApply: (picked, origin) => edits.apply(picked, d.context, origin),
    onUndo: (changes) => edits.undo(changes),
    onRedo: (changes) => edits.redo(changes, d.context),
    onAudit: async () => '',
    onDismissFinding: () => {},
    onClose: () => {},
    onSettings: () => {},
    history: edits.history,
    liveChanges: (ids) => edits.history.liveChanges(ids),
  });
  document.body.appendChild(p.el);
  const q = <T extends HTMLElement>(sel: string): T | null => p.el.querySelector<T>(sel);
  return { d, edits, p, q };
}

describe('Undo on the fixed row', () => {
  it('takes the fix out right from the list, then puts it back', async () => {
    const { d, edits, p, q } = panelOver('This is a very good sentence.', { find: 'very good', replace: 'good' });
    await vi.waitFor(() => expect(q('.mrclippy-fix-apply')?.hidden).toBe(false));
    q<HTMLButtonElement>('.mrclippy-fix-apply')!.click();
    await vi.waitFor(() => expect(q('.mrclippy-nr')?.dataset.state).toBe('applied'));
    expect(d.area.value).toBe('This is a good sentence.');

    const undo = q<HTMLButtonElement>('.mrclippy-row-undo')!;
    expect(undo.hidden).toBe(false);
    expect(undo.textContent).toBe('Undo');
    undo.click();
    expect(undo.textContent).toBe('Undoing…');
    await vi.waitFor(() => expect(q('.mrclippy-nr')?.dataset.state).toBe('undone'));
    expect(q('.mrclippy-nr-st')?.textContent).toBe('Undone');
    expect(undo.textContent).toBe('Redo');
    expect(d.area.value).toBe('This is a very good sentence.');

    undo.click();
    await vi.waitFor(() => expect(q('.mrclippy-nr')?.dataset.state).toBe('applied'));
    expect(q('.mrclippy-nr-st')?.textContent).toBe('Applied');
    expect(d.area.value).toBe('This is a good sentence.');
    await vi.waitFor(() => expect(saved()[0]?.state).toBe('applied'));
    p.dispose();
    edits.dispose();
  });

  it('says so plainly when the text is gone', async () => {
    const { d, edits, p, q } = panelOver('This is a very good sentence.', { find: 'very good', replace: 'good' });
    await vi.waitFor(() => expect(q('.mrclippy-fix-apply')?.hidden).toBe(false));
    q<HTMLButtonElement>('.mrclippy-fix-apply')!.click();
    await vi.waitFor(() => expect(q('.mrclippy-nr')?.dataset.state).toBe('applied'));
    d.area.value = 'Rewritten entirely by hand.';
    q<HTMLButtonElement>('.mrclippy-row-undo')!.click();
    await vi.waitFor(() => expect(q('.mrclippy-nr-note')?.textContent).toContain("Couldn't undo it"));
    expect(d.area.value).toBe('Rewritten entirely by hand.');
    expect(q('.mrclippy-nr')?.dataset.state).toBe('applied');
    p.dispose();
    edits.dispose();
  });
});

describe('the History screen', () => {
  async function applied() {
    const t = panelOver('This is a very good sentence.', { find: 'very good', replace: 'good' });
    await vi.waitFor(() => expect(t.q('.mrclippy-fix-apply')?.hidden).toBe(false));
    t.q<HTMLButtonElement>('.mrclippy-fix-apply')!.click();
    await vi.waitFor(() => expect(saved()).toHaveLength(1));
    return t;
  }

  it('opens from the title bar with the change, where it came from and when', async () => {
    const { p, q, edits } = await applied();
    const history = q<HTMLButtonElement>('.mrclippy-titlebtn-history')!;
    expect(history.hidden).toBe(false);
    expect(history.nextElementSibling?.textContent).toBe('Settings');
    history.click();
    await vi.waitFor(() => expect(q('.mrclippy-hist')).not.toBeNull());
    expect(q('.mrclippy-title')?.textContent).toBe('History');
    expect(q('.mrclippy-hist-meta')?.textContent).toContain('just now');
    expect(q('.mrclippy-hist-meta')?.textContent).toContain('Wordy');
    expect(q('.mrclippy-history-privacy')?.textContent).toContain('this computer only');
    p.dispose();
    edits.dispose();
  });

  it('Undo all takes every change out, and Redo all puts them back; the fixed row follows', async () => {
    const { d, p, q, edits } = await applied();
    const row = q('.mrclippy-nr')!; // The notes screen leaves the panel while History shows.
    q<HTMLButtonElement>('.mrclippy-titlebtn-history')!.click();
    await vi.waitFor(() => expect(q('.mrclippy-hist')).not.toBeNull());
    const [undoAll, redoAll] = [...p.el.querySelectorAll<HTMLButtonElement>('.mrclippy-history-bar button')];
    expect(redoAll!.disabled).toBe(true);
    undoAll!.click();
    await vi.waitFor(() => expect(d.area.value).toBe('This is a very good sentence.'));
    await vi.waitFor(() => expect(q('.mrclippy-hist')?.dataset.state).toBe('undone'));
    // The notes row heard about it without touching the doc again.
    expect(row.dataset.state).toBe('undone');
    expect(redoAll!.disabled).toBe(false);
    redoAll!.click();
    await vi.waitFor(() => expect(d.area.value).toBe('This is a good sentence.'));
    await vi.waitFor(() => expect(row.dataset.state).toBe('applied'));
    p.dispose();
    edits.dispose();
  });

  it('marks an entry "Changed since" and leaves the doc alone', async () => {
    const { d, p, q, edits } = await applied();
    d.area.value = 'Someone rewrote this.';
    q<HTMLButtonElement>('.mrclippy-titlebtn-history')!.click();
    await vi.waitFor(() => expect(q('.mrclippy-hist-toggle')).not.toBeNull());
    q<HTMLButtonElement>('.mrclippy-hist-toggle')!.click();
    await vi.waitFor(() => expect(q('.mrclippy-hist .mrclippy-why')?.textContent).toBe("Changed since. Can't undo safely."));
    expect(d.area.value).toBe('Someone rewrote this.');
    p.dispose();
    edits.dispose();
  });

  it('is still there after a reload', async () => {
    const first = await applied();
    first.p.dispose();
    first.edits.dispose();
    // A new page: a new panel over a new DocEdits, same doc id.
    const source = first.d.source;
    const edits = new DocEdits(source, URL_A);
    const p = new ChatPanel({
      findings: [], onAsk: async () => ({ text: '' }), onAudit: async () => '', onDismissFinding: () => {},
      onClose: () => {}, onSettings: () => {}, history: edits.history,
    });
    document.body.appendChild(p.el);
    p.el.querySelector<HTMLButtonElement>('.mrclippy-titlebtn-history')!.click();
    await vi.waitFor(() => expect(p.el.querySelectorAll('.mrclippy-hist')).toHaveLength(1));
    p.dispose();
    edits.dispose();
  });

  it('works from the chat: "show history", "undo the last fix", "undo all"', async () => {
    expect(matchCommand('show history')).toEqual({ action: 'show_history' });
    expect(matchCommand('Undo the last fix.')).toEqual({ action: 'undo_last' });
    expect(matchCommand('undo all')).toEqual({ action: 'undo_all' });

    const { d, p, q, edits } = await applied();
    const type = async (text: string) => {
      q<HTMLTextAreaElement>('.mrclippy-input')!.value = text;
      q<HTMLFormElement>('.mrclippy-composer')!.requestSubmit();
      await flush();
    };
    await type('show history');
    await vi.waitFor(() => expect(q('.mrclippy-title')?.textContent).toBe('History'));
    await type('undo the last fix');
    await vi.waitFor(() => expect(d.area.value).toBe('This is a very good sentence.'));
    await type('redo');
    await vi.waitFor(() => expect(d.area.value).toBe('This is a good sentence.'));
    await type('undo all');
    await vi.waitFor(() => expect(d.area.value).toBe('This is a very good sentence.'));
    p.dispose();
    edits.dispose();
  });

  it('Clear history asks once more, then empties the list', async () => {
    const { p, q, edits, d } = await applied();
    q<HTMLButtonElement>('.mrclippy-titlebtn-history')!.click();
    await vi.waitFor(() => expect(q('.mrclippy-hist')).not.toBeNull());
    const clear = [...p.el.querySelectorAll<HTMLButtonElement>('.mrclippy-history-bar button')].at(-1)!;
    clear.click();
    expect(clear.textContent).toBe('Click again to clear');
    expect(saved()).toHaveLength(1);
    clear.click();
    await vi.waitFor(() => expect(q('.mrclippy-hist')).toBeNull());
    expect(saved()).toHaveLength(0);
    expect(d.area.value).toBe('This is a good sentence.');
    p.dispose();
    edits.dispose();
  });
});

it('says how long ago in plain words', () => {
  const now = 10_000_000;
  expect(ago(now - 5_000, now)).toBe('just now');
  expect(ago(now - 2 * 60_000, now)).toBe('2 min ago');
  expect(ago(now - 3 * 3_600_000, now)).toBe('3 h ago');
  expect(ago(now - 30 * 3_600_000, now)).toBe('yesterday');
  expect(ago(now - 4 * 86_400_000, now)).toBe('4 days ago');
});

