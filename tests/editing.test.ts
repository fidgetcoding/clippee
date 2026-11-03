import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { parseEditCall } from '../src/agent/client';
import { EDIT_TOOL } from '../src/agent/prompt';
import { DocsBridgeClient } from '../src/docs/bridgeClient';
import { installBridge } from '../src/docs/mainWorld';
import { landed, locate, normalize } from '../src/docs/match';
import { FieldEditor } from '../src/content/fieldEditor';

describe('locating an edit', () => {
  it('finds a passage that appears once', () => {
    expect(locate('one two three', 'two')).toEqual({ start: 4, end: 7 });
  });

  it('refuses a passage that appears twice rather than guessing', () => {
    expect(locate('the cat and the cat', 'the cat')).toEqual({ error: 'ambiguous', count: 2 });
  });

  it('picks the occurrence nearest the hint when undo supplies one', () => {
    expect(locate('the cat and the cat', 'the cat', 14)).toEqual({ start: 12, end: 19 });
  });

  it('matches a straight quote against a curly one', () => {
    const doc = 'It’s a “plan”.';
    expect(locate(doc, 'It\'s a "plan"')).toEqual({ start: 0, end: 13 });
  });

  it('keeps indices valid after normalising', () => {
    // One character in, one character out, or every later index is wrong.
    const doc = '“A” — b c';
    expect(normalize(doc)).toHaveLength(doc.length);
  });

  it('reports a passage that is not there', () => {
    expect(locate('one two', 'three')).toEqual({ error: 'not-found', count: 0 });
  });

  it('treats an empty passage plus a position as an insertion point', () => {
    expect(locate('abc', '', 1)).toEqual({ start: 1, end: 1 });
    expect(locate('abc', '')).toEqual({ error: 'not-found', count: 0 });
  });

  it('confirms text landed where it was written', () => {
    expect(landed('say it’s fine', 4, "it's")).toBe(true);
    expect(landed('say no', 4, "it's")).toBe(false);
  });
});

describe('the edit tool call', () => {
  it('passes well formed edits through', () => {
    const parsed = parseEditCall({
      edits: [{ find: 'very very', replace: 'very' }],
      summary: 'Cut a repeat.',
    });
    expect(parsed).toEqual({ edits: [{ find: 'very very', replace: 'very' }], summary: 'Cut a repeat.' });
  });

  it('drops malformed and no-op edits instead of repairing them', () => {
    const parsed = parseEditCall({
      edits: [
        { find: 'a', replace: 'a' },
        { find: '', replace: 'x' },
        { find: 'b' },
        null,
        { find: 'c', replace: '' },
      ],
    });
    expect(parsed.edits).toEqual([{ find: 'c', replace: '' }]);
    expect(parsed.summary).toBe('');
  });

  it('survives garbage input', () => {
    expect(parseEditCall(undefined).edits).toEqual([]);
    expect(parseEditCall('nope').edits).toEqual([]);
  });

  it('caps the number of edits', () => {
    const edits = Array.from({ length: 60 }, (_, i) => ({ find: `w${i}`, replace: `x${i}` }));
    expect(parseEditCall({ edits }).edits.length).toBeLessThanOrEqual(25);
  });

  it('declares find and replace as required', () => {
    expect(EDIT_TOOL.input_schema.required).toContain('edits');
    expect(EDIT_TOOL.input_schema.properties.edits.items.required).toEqual(['find', 'replace']);
  });
});

/**
 * A stand-in for Google Docs, shaped like the real thing as observed live on
 * 2026-11-02: a U+0003 marker at index 0, `getSelection` returning an array,
 * `setSelection(start, end)` taking two numbers, and an offscreen contenteditable
 * that applies a paste to the selection.
 */
describe('Docs bridge edits', () => {
  let doc = '';
  let selection = { start: 0, end: 0 };

  beforeAll(() => {
    if (typeof globalThis.DataTransfer === 'undefined') {
      class FakeDataTransfer {
        private readonly data = new Map<string, string>();
        setData(type: string, value: string): void {
          this.data.set(type, value);
        }
        getData(type: string): string {
          return this.data.get(type) ?? '';
        }
      }
      (globalThis as unknown as { DataTransfer: unknown }).DataTransfer = FakeDataTransfer;
    }
    if (typeof globalThis.ClipboardEvent === 'undefined') {
      class FakeClipboardEvent extends Event {
        readonly clipboardData: DataTransfer | null;
        constructor(type: string, init: EventInit & { clipboardData?: DataTransfer | null }) {
          super(type, init);
          this.clipboardData = init.clipboardData ?? null;
        }
      }
      (globalThis as unknown as { ClipboardEvent: unknown }).ClipboardEvent = FakeClipboardEvent;
    }

    const frame = document.createElement('iframe');
    frame.className = 'docs-texteventtarget-iframe';
    document.body.appendChild(frame);
    const target = frame.contentDocument!.createElement('div');
    target.setAttribute('contenteditable', 'true');
    frame.contentDocument!.body.appendChild(target);
    target.addEventListener('paste', (event) => {
      const text = (event as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
      doc = doc.slice(0, selection.start) + text + doc.slice(selection.end);
      selection = { start: selection.start + text.length, end: selection.start + text.length };
    });

    window._docs_annotate_canvas_by_ext = 'test';
    (window as unknown as { _docs_annotate_getAnnotatedText: unknown })._docs_annotate_getAnnotatedText =
      async () => ({
        getText: () => doc,
        getSelection: () => [selection],
        setSelection: (start: number, end: number) => {
          selection = { start, end };
        },
      });
    installBridge('test');
  });

  afterEach(() => {
    doc = '';
    selection = { start: 0, end: 0 };
  });

  it('strips the document marker from text', async () => {
    doc = '\u0003Hello world\n';
    const client = new DocsBridgeClient();
    expect(await client.getText()).toBe('Hello world\n');
    client.dispose();
  });

  it('reads a selection Docs returns as an array', async () => {
    doc = '\u0003Hello world\n';
    selection = { start: 7, end: 12 };
    const client = new DocsBridgeClient();
    expect(await client.getSelection()).toEqual({ start: 6, end: 11, text: 'world' });
    client.dispose();
  });

  it('replaces a passage and verifies it landed', async () => {
    doc = '\u0003This is really very wordy.\n';
    const client = new DocsBridgeClient();
    const outcome = await client.replace('really very wordy', 'tight');
    expect(outcome).toEqual({ applied: true, start: 8 });
    expect(doc).toBe('\u0003This is tight.\n');
    client.dispose();
  });

  it('deletes with an empty replacement and undoes by inserting back', async () => {
    doc = '\u0003Keep this. Cut this. Keep that.\n';
    const client = new DocsBridgeClient();
    const cut = await client.replace(' Cut this.', '');
    expect(cut.applied).toBe(true);
    expect(doc).toBe('\u0003Keep this. Keep that.\n');

    const start = cut.applied ? cut.start : -1;
    const back = await client.replace('', ' Cut this.', start);
    expect(back.applied).toBe(true);
    expect(doc).toBe('\u0003Keep this. Cut this. Keep that.\n');
    client.dispose();
  });

  it('leaves the document alone when the passage is ambiguous', async () => {
    doc = '\u0003the end. the end.\n';
    const client = new DocsBridgeClient();
    expect(await client.replace('the end.', 'fin.')).toEqual({ applied: false, reason: 'ambiguous' });
    expect(doc).toBe('\u0003the end. the end.\n');
    client.dispose();
  });
});

describe('text box edits', () => {
  it('edits the textarea you were typing in', () => {
    const area = document.createElement('textarea');
    area.value = 'Dear team, I am writing to let you know the launch moved.';
    document.body.appendChild(area);
    const editor = new FieldEditor();
    area.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    let heard = false;
    area.addEventListener('input', () => {
      heard = true;
    });

    const outcome = editor.replace('I am writing to let you know the', 'the');
    expect(outcome).toEqual({ applied: true, start: 11 });
    expect(area.value).toBe('Dear team, the launch moved.');
    expect(heard).toBe(true);

    editor.dispose();
    area.remove();
  });

  it('ignores focus inside his own panel', () => {
    const host = document.createElement('div');
    host.id = 'mrclippy-host';
    document.body.appendChild(host);
    const editor = new FieldEditor();
    host.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(editor.active).toBe(false);
    expect(editor.replace('a', 'b')).toEqual({ applied: false, reason: 'unavailable' });
    editor.dispose();
    host.remove();
  });
});
