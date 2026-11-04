import { expect, it } from 'vitest';
import { EditHistory } from '../src/content/editHistory';
import { FieldEditor } from '../src/content/fieldEditor';
import type { DocumentSource } from '../src/content/documentSource';
it('refuses to undo onto a different repeated phrase after the document changes', async () => {
  const area = document.createElement('textarea');
  area.value = 'one old two new';
  document.body.append(area);
  const field = new FieldEditor();
  area.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  const source: DocumentSource = {
    id: 'test', matches: () => true, read: async () => field.read(), canEdit: () => field.active,
    replace: async (find, text, near) => field.replace(find, text, near),
    select: async () => false, boxes: () => [],
  };
  const history = new EditHistory(source);
  const changes = await history.apply([{ find: 'old', replace: 'new' }]);
  expect(area.value).toBe('one new two new');
  area.value = 'one changed two new';
  await expect(history.undo(changes)).rejects.toThrow('safely');
  expect(area.value).toBe('one changed two new');
  field.dispose(); area.remove();
});
it('keeps individual redo and aggregate undo attached to the same receipts', async () => {
  const area = document.createElement('textarea');
  area.value = 'one old two stale';
  document.body.append(area);
  const field = new FieldEditor();
  area.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  const source: DocumentSource = {
    id: 'test', matches: () => true, read: async () => field.read(), canEdit: () => field.active,
    replace: async (find, text, near) => field.replace(find, text, near),
    select: async () => false, boxes: () => [],
  };
  const history = new EditHistory(source);
  const changes = await history.apply([{ find: 'old', replace: 'new' }, { find: 'stale', replace: 'fresh' }]);
  await history.undo([changes[1]!]);
  const redone = await history.redo([changes[1]!]);
  expect(redone[0]).toBe(changes[1]);
  await history.undo(changes);
  expect(area.value).toBe('one old two stale');
  field.dispose(); area.remove();
});

function fixture(text: string) {
  const area = document.createElement('textarea'); area.value = text; document.body.append(area);
  const field = new FieldEditor(); area.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  const source: DocumentSource = {
    id: 'test', matches: () => true, read: async () => field.read(), canEdit: () => field.active,
    context: () => field.identity,
    replace: async (find, value, near) => field.replace(find, value, near),
    select: async () => false, boxes: () => [],
  };
  return { area, field, source, history: new EditHistory(source), dispose: () => { field.dispose(); area.remove(); } };
}
it('rechecks a receipt after native redo instead of claiming it is still undone', async () => {
  const f = fixture('old');
  const changes = await f.history.apply([{ find: 'old', replace: 'new' }]);
  await f.history.undo(changes);
  f.area.value = 'new'; // Native editor redo outside the panel.
  await f.history.undo(changes);
  expect(f.area.value).toBe('old');
  f.dispose();
});

it('round-trips a full deletion twice through Undo and Redo', async () => {
  const f = fixture('Original text');
  const changes = await f.history.apply([{ find: 'Original text', replace: '' }]);
  expect(f.area.value).toBe('');
  for (let i = 0; i < 2; i++) {
    await f.history.undo(changes); expect(f.area.value).toBe('Original text');
    await f.history.redo(changes); expect(f.area.value).toBe('');
  }
  f.dispose();
});
it('restores exact original punctuation after normalized matching', async () => {
  const f = fixture('It’s good.');
  const changes = await f.history.apply([{ find: "It's good.", replace: 'Good.' }]);
  expect(changes[0]?.find).toBe('It’s good.');
  await f.history.undo(changes);
  expect(f.area.value).toBe('It’s good.');
  f.dispose();
});
it('serializes concurrent batches so aggregate undo has consistent snapshots', async () => {
  const f = fixture('old and stale');
  const [a, b] = await Promise.all([
    f.history.apply([{ find: 'old', replace: 'new' }]),
    f.history.apply([{ find: 'stale', replace: 'fresh' }]),
  ]);
  expect(f.area.value).toBe('new and fresh');
  await f.history.undo([...a, ...b]);
  expect(f.area.value).toBe('old and stale');
  f.dispose();
});
it('refuses an accepted proposal after the user switches text fields', async () => {
  const f = fixture('old');
  const context = f.field.identity;
  const other = document.createElement('textarea'); other.value = 'old'; document.body.append(other);
  other.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  const changes = await f.history.apply([{ find: 'old', replace: 'new' }], context);
  expect(changes[0]?.applied).toBe(false);
  expect(f.area.value).toBe('old'); expect(other.value).toBe('old');
  other.remove(); f.dispose();
});
it('reports partial undo accurately and retries only the remaining change', async () => {
  const f = fixture('old and stale');
  const changes = await f.history.apply([{ find: 'old', replace: 'new' }, { find: 'stale', replace: 'fresh' }]);
  const replace = f.source.replace;
  f.source.replace = async (find, text, near) => find === 'new' ? { applied: false, reason: 'unavailable' } : replace(find, text, near);
  const result = await f.history.undo(changes);
  expect(result.undone).toEqual([changes[1]]);
  expect(f.area.value).toBe('new and stale');
  f.source.replace = replace;
  await f.history.undo([changes[0]!]);
  expect(f.area.value).toBe('old and stale');
  f.dispose();
});
it('cancels an edit waiting on a read when its document source is disposed', async () => {
  const f = fixture('old');
  let release!: (text: string) => void;
  f.source.read = () => new Promise((resolve) => { release = resolve; });
  const pending = f.history.apply([{ find: 'old', replace: 'new' }]);
  await Promise.resolve();
  f.history.dispose();
  release('old');
  const changes = await pending;
  expect(changes[0]?.applied).toBe(false);
  expect(f.area.value).toBe('old');
  f.dispose();
});
