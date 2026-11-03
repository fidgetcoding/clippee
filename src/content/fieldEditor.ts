import { landed, locate } from '../docs/match';
import type { EditOutcome } from '../docs/protocol';

/**
 * Editing outside Google Docs: the text box you were last typing in.
 *
 * Tracked on `focusin` rather than read from `document.activeElement` at ask
 * time, because by then focus has moved into Mr. Clippy's own chat box. Events
 * from inside his shadow root retarget to the host element, which is ignored.
 */

type Field = HTMLTextAreaElement | HTMLInputElement | HTMLElement;

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', '']);
const HOST_ID = 'mrclippy-host';

function editableFrom(target: EventTarget | null): Field | undefined {
  if (!(target instanceof HTMLElement) || target.id === HOST_ID) return undefined;
  if (target instanceof HTMLTextAreaElement) return target;
  if (target instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(target.type) ? target : undefined;
  }
  if (target.isContentEditable) {
    // The outermost editable element is the document; an inner span is not.
    let root: HTMLElement = target;
    while (root.parentElement?.isContentEditable) root = root.parentElement;
    return root;
  }
  return undefined;
}

function isPlainField(field: Field): field is HTMLTextAreaElement | HTMLInputElement {
  return field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement;
}

/** Text nodes of a contenteditable, with the offset each one starts at. */
function textNodes(root: HTMLElement): { node: Text; start: number }[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out: { node: Text; start: number }[] = [];
  let offset = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    out.push({ node: text, start: offset });
    offset += text.data.length;
  }
  return out;
}

function rangeAt(root: HTMLElement, start: number, end: number): Range | undefined {
  const nodes = textNodes(root);
  const point = (at: number): [Text, number] | undefined => {
    for (const { node, start: from } of nodes) {
      if (at <= from + node.data.length) return [node, at - from];
    }
    return undefined;
  };
  const a = point(start);
  const b = point(end);
  if (!a || !b) return undefined;
  const range = document.createRange();
  range.setStart(a[0], a[1]);
  range.setEnd(b[0], b[1]);
  return range;
}

export class FieldEditor {
  private field: Field | undefined;
  private readonly onFocus = (event: FocusEvent): void => {
    const field = editableFrom(event.target);
    if (field) this.field = field;
  };

  constructor() {
    document.addEventListener('focusin', this.onFocus, true);
    this.field = editableFrom(document.activeElement);
  }

  dispose(): void {
    document.removeEventListener('focusin', this.onFocus, true);
    this.field = undefined;
  }

  /** The text of the field, or undefined when there is no usable field. */
  read(): string | undefined {
    const field = this.field;
    if (!field?.isConnected) return undefined;
    const text = isPlainField(field) ? field.value : (field.textContent ?? '');
    return text.trim().length > 0 ? text : undefined;
  }

  get active(): boolean {
    return this.read() !== undefined;
  }

  /** Select the first occurrence of `passage` and scroll it into view. */
  select(passage: string): boolean {
    const field = this.field;
    const current = this.read();
    if (!field || current === undefined) return false;
    const hit = locate(current, passage, 0);
    if ('error' in hit) return false;

    if (isPlainField(field)) {
      field.focus({ preventScroll: true });
      field.setSelectionRange(hit.start, hit.end);
      field.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return true;
    }
    const range = rangeAt(field, hit.start, hit.end);
    if (!range) return false;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return true;
  }

  /** Screen boxes for `passage` in a rich-text field. Plain fields cannot say. */
  boxes(passage: string): { left: number; top: number; width: number; height: number }[] {
    const field = this.field;
    const current = this.read();
    if (!field || current === undefined || isPlainField(field)) return [];
    const hit = locate(current, passage, 0);
    if ('error' in hit) return [];
    const range = rangeAt(field, hit.start, hit.end);
    if (!range) return [];
    return [...range.getClientRects()].map((r) => ({
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
    }));
  }

  replace(find: string, text: string, near?: number): EditOutcome {
    const field = this.field;
    const current = this.read();
    if (!field || current === undefined) return { applied: false, reason: 'unavailable' };

    const hit = locate(current, find, near);
    if ('error' in hit) return { applied: false, reason: hit.error };

    if (isPlainField(field)) {
      field.setRangeText(text, hit.start, hit.end, 'end');
      // Frameworks (React, Vue) only notice a change they hear about.
      field.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      const range = rangeAt(field, hit.start, hit.end);
      if (!range) return { applied: false, reason: 'unavailable' };
      field.focus();
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      // execCommand is deprecated and still the only call that edits a
      // contenteditable the way typing does: rich editors see it, and it lands
      // in the native undo stack.
      const ok =
        text.length > 0
          ? document.execCommand('insertText', false, text)
          : document.execCommand('delete');
      if (!ok) {
        range.deleteContents();
        if (text.length > 0) range.insertNode(document.createTextNode(text));
      }
    }

    const after = this.read() ?? '';
    return landed(after, hit.start, text)
      ? { applied: true, start: hit.start }
      : { applied: false, reason: 'unverified' };
  }
}
