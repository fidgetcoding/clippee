/**
 * Reconstruct document text from the annotated canvas.
 *
 * Once `_docs_annotate_canvas_by_ext` is set, Google Docs emits real SVG
 * `<rect aria-label="...">` nodes alongside the canvas it paints — an
 * accessibility layer carrying the text of each run and its geometry. Scraping
 * those is how Harper reads Docs (Apache-2.0), and it is more durable than
 * calling an undocumented JS function, because it consumes rendered output
 * rather than internal API.
 *
 * The cost is that geometry is all you get: rects arrive in paint order, not
 * reading order, so lines have to be rebuilt from coordinates. This is a
 * deliberately simpler reconstruction than Harper's — band grouping and
 * soft-wrap spacing, without their gap-repair heuristics — because Mr. Clippy needs
 * text for statistics, not pixel-accurate ranges for drawing underlines.
 */

export const EDITOR_SELECTOR = '.kix-appview-editor';
export const RECT_SELECTOR = 'rect[aria-label]';

export interface RectSegment {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Rects whose vertical centres fall within this fraction of a line share a line. */
const BAND_TOLERANCE = 0.5;
/** Horizontal gap, relative to line height, that implies a space between runs. */
const SPACE_GAP_RATIO = 0.25;

export function collectSegments(root: ParentNode = document): RectSegment[] {
  const editor = root.querySelector(EDITOR_SELECTOR) ?? root;
  const segments: RectSegment[] = [];

  for (const node of editor.querySelectorAll(RECT_SELECTOR)) {
    const label = node.getAttribute('aria-label');
    if (!label) continue;

    segments.push({
      text: label,
      x: numberAttr(node, 'x'),
      y: numberAttr(node, 'y'),
      width: numberAttr(node, 'width'),
      height: numberAttr(node, 'height'),
    });
  }

  return segments;
}

function numberAttr(node: Element, name: string): number {
  const raw = node.getAttribute(name);
  const value = raw === null ? Number.NaN : Number.parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Group segments into visual lines, then order each line left to right.
 *
 * Banding on the vertical centre rather than `y` handles runs of mixed font size
 * on one line — a heading fragment and body text share a baseline but not a top
 * edge.
 */
export function toLines(segments: readonly RectSegment[]): RectSegment[][] {
  if (segments.length === 0) return [];

  const sorted = [...segments].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: RectSegment[][] = [];

  let current: RectSegment[] = [];
  let bandCentre = centreOf(sorted[0]!);
  let bandHeight = sorted[0]!.height || 1;

  for (const segment of sorted) {
    const centre = centreOf(segment);
    const tolerance = Math.max(bandHeight, segment.height || 1) * BAND_TOLERANCE;

    if (current.length > 0 && Math.abs(centre - bandCentre) > tolerance) {
      lines.push(current.sort((a, b) => a.x - b.x));
      current = [];
    }

    if (current.length === 0) {
      bandCentre = centre;
      bandHeight = segment.height || 1;
    }
    current.push(segment);
  }

  if (current.length > 0) lines.push(current.sort((a, b) => a.x - b.x));
  return lines;
}

function centreOf(segment: RectSegment): number {
  return segment.y + (segment.height || 0) / 2;
}

/**
 * Join lines into document text.
 *
 * Two judgement calls, both erring toward under-inserting whitespace: a space is
 * added between runs on the same line only when the visual gap is wide enough to
 * be one, and every line break becomes a newline. Over-inserting spaces would
 * inflate the word count and corrupt every downstream statistic.
 */
export function segmentsToText(segments: readonly RectSegment[]): string {
  const lines = toLines(segments);
  const out: string[] = [];

  for (const line of lines) {
    let text = '';
    let previousEnd: number | undefined;
    let lineHeight = 1;

    for (const segment of line) {
      lineHeight = Math.max(lineHeight, segment.height || 1);
      if (previousEnd !== undefined) {
        const gap = segment.x - previousEnd;
        const needsSpace = gap > lineHeight * SPACE_GAP_RATIO;
        if (needsSpace && !/\s$/.test(text) && !/^\s/.test(segment.text)) text += ' ';
      }
      text += segment.text;
      previousEnd = segment.x + (segment.width || 0);
    }

    out.push(text.trimEnd());
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Full pipeline: scrape the DOM and return reading-order text. */
export function readDocumentText(root: ParentNode = document): string {
  return segmentsToText(collectSegments(root));
}
