/** Long passages are shortened; the document has the full text. */
export function clip(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}\u2026` : flat;
}

/**
 * The part of an edit that actually changes, with a little context either side.
 *
 * Showing the whole `find` struck through and the whole `replace` below hides
 * small changes — a paragraph split looks like the same sentence twice, because
 * the only difference is a newline. Trimming the shared prefix and suffix to
 * word boundaries leaves just the change, and line breaks get a visible marker.
 */
export function diffParts(before: string, after: string): {
  lead: string;
  removed: string;
  added: string;
  tail: string;
} {
  let p = 0;
  const max = Math.min(before.length, after.length);
  while (p < max && before[p] === after[p]) p++;
  // Back up to a word boundary so a half-changed word is shown whole.
  while (p > 0 && /\S/.test(before[p - 1] ?? '') && /\S/.test(before[p] ?? ' ')) p--;

  let s = 0;
  while (
    s < before.length - p &&
    s < after.length - p &&
    before[before.length - 1 - s] === after[after.length - 1 - s]
  ) {
    s++;
  }
  while (s > 0 && /\S/.test(before[before.length - s] ?? '') && /\S/.test(before[before.length - s - 1] ?? ' ')) s--;

  return {
    lead: before.slice(0, p),
    removed: before.slice(p, before.length - s),
    added: after.slice(p, after.length - s),
    tail: before.slice(before.length - s),
  };
}

const CONTEXT_CHARS = 40;

export function renderDiff(before: string, after: string): HTMLElement {
  const { lead, removed, added, tail } = diffParts(before, after);
  const line = document.createElement('div');
  line.className = 'mrclippy-diff';

  const context = (text: string, side: 'lead' | 'tail'): void => {
    const flat = text.replace(/\s+/g, ' ');
    if (flat.trim().length === 0) return;
    const shown =
      flat.length <= CONTEXT_CHARS
        ? flat
        : side === 'lead'
          ? `\u2026${flat.slice(-CONTEXT_CHARS)}`
          : `${flat.slice(0, CONTEXT_CHARS)}\u2026`;
    const span = document.createElement('span');
    span.className = 'mrclippy-diff-context';
    span.textContent = shown;
    line.appendChild(span);
  };

  /** Text with its line breaks drawn as markers instead of swallowed as spaces. */
  const marked = (tag: 'del' | 'ins', raw: string): void => {
    // Whitespace-only and no line break: nothing a reader could see.
    let text = raw;
    if (!/\S|\n/.test(text)) return;
    // Spaces at the edges belong to the sentence, not the change: drawing them
    // inside the strike or highlight glues the mark to the next word.
    const lead = /^[ \t]+/.test(text);
    const trail = /[ \t]+$/.test(text);
    text = text.replace(/^[ \t]+|[ \t]+$/g, '');
    if (lead) line.appendChild(document.createTextNode(' '));
    const el = document.createElement(tag);
    const parts = text.split(/\n+/);
    parts.forEach((part, i) => {
      if (i > 0) {
        const mark = document.createElement('span');
        mark.className = 'mrclippy-diff-break';
        mark.textContent = tag === 'ins' ? '\u00b6 new paragraph' : '\u00b6 paragraph break removed';
        el.appendChild(mark);
      }
      const flat = part.replace(/\s+/g, ' ');
      if (flat.trim().length > 0) el.appendChild(document.createTextNode(clip(flat, 400)));
    });
    line.appendChild(el);
    if (trail) line.appendChild(document.createTextNode(' '));
  };

  context(lead, 'lead');
  marked('del', removed);
  marked('ins', added);
  context(tail, 'tail');
  return line;
}

