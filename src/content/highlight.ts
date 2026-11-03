import { RECT_SELECTOR } from '../docs/rectScrape';

/**
 * A loud highlight over the passage a note or proposal is about.
 *
 * The page's own selection is a pale tint that is easy to miss, so after
 * selecting the passage we paint our own boxes on top, in the shadow root.
 * Purely visual: `pointer-events: none`, cleared on scroll (the boxes are fixed
 * to the viewport and would drift) and after a few seconds.
 */

const FADE_AFTER_MS = 6_000;

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const collapse = (text: string): string => text.replace(/\s+/g, ' ').toLowerCase();

/**
 * Where `passage` sits on screen in Google Docs.
 *
 * With the annotation flag on, Docs mirrors each painted run of text as an SVG
 * `rect[aria-label]`. Join the runs in reading order, find the passage in that
 * string, and turn the covered characters of each run back into a box. Widths
 * inside a run are split by character count, which is close enough to point at.
 */
export function docsBoxes(passage: string, root: ParentNode = document): Box[] {
  const runs = [...root.querySelectorAll(RECT_SELECTOR)]
    .map((el) => ({ label: collapse(el.getAttribute('aria-label') ?? ''), rect: el.getBoundingClientRect() }))
    .filter((r) => r.label.length > 0 && r.rect.width > 0)
    .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);

  let haystack = '';
  const spans: { start: number; end: number; rect: DOMRect }[] = [];
  for (const run of runs) {
    if (haystack.length > 0) haystack += ' ';
    spans.push({ start: haystack.length, end: haystack.length + run.label.length, rect: run.rect });
    haystack += run.label;
  }

  const needle = collapse(passage).trim();
  if (needle.length === 0) return [];
  const at = haystack.indexOf(needle);
  if (at < 0) return [];
  const end = at + needle.length;

  const boxes: Box[] = [];
  for (const span of spans) {
    if (span.end <= at || span.start >= end) continue;
    const length = span.end - span.start || 1;
    const from = (Math.max(at, span.start) - span.start) / length;
    const to = (Math.min(end, span.end) - span.start) / length;
    boxes.push({
      left: span.rect.left + span.rect.width * from,
      top: span.rect.top,
      width: span.rect.width * (to - from),
      height: span.rect.height,
    });
  }
  return boxes;
}

export class Highlighter {
  private readonly layer: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly onScroll = (): void => this.clear();

  constructor(root: ShadowRoot) {
    this.layer = document.createElement('div');
    this.layer.className = 'mrclippy-highlights';
    root.appendChild(this.layer);
    document.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
  }

  show(boxes: readonly Box[]): void {
    this.clear();
    for (const b of boxes) {
      const el = document.createElement('div');
      el.className = 'mrclippy-highlight';
      el.style.left = `${b.left}px`;
      el.style.top = `${b.top}px`;
      el.style.width = `${b.width}px`;
      el.style.height = `${b.height}px`;
      this.layer.appendChild(el);
    }
    if (boxes.length > 0) this.timer = setTimeout(() => this.clear(), FADE_AFTER_MS);
  }

  clear(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.layer.replaceChildren();
  }

  dispose(): void {
    this.clear();
    document.removeEventListener('scroll', this.onScroll, { capture: true });
    this.layer.remove();
  }
}
