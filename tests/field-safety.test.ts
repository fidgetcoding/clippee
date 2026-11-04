import { afterEach, expect, it } from 'vitest';
import { FieldEditor } from '../src/content/fieldEditor';
afterEach(() => document.body.replaceChildren());
it('undoes a whole-field deletion without switching to page text', () => {
  const area = document.createElement('textarea');
  area.value = 'Original text';
  document.body.append(area);
  const editor = new FieldEditor();
  area.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  expect(editor.replace('Original text', '')).toEqual({ applied: true, start: 0 });
  expect(editor.read()).toBe('');
  expect(editor.replace('', 'Original text', 0)).toEqual({ applied: true, start: 0 });
  expect(area.value).toBe('Original text');
  editor.dispose();
});
it('refuses fields that became read-only after focus', () => {
  const area = document.createElement('textarea');
  area.value = 'Keep me';
  document.body.append(area);
  const editor = new FieldEditor();
  area.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  area.readOnly = true;
  expect(editor.replace('Keep', 'Lose').applied).toBe(false);
  expect(area.value).toBe('Keep me');
  editor.dispose();
});
