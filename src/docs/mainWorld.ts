import { landed, locate, normalize } from './match';
import {
  EVENT_REQUEST,
  EVENT_RESPONSE,
  PROTOCOL,
  ReadStrategy,
  isRequestMessage,
  type DocsRequest,
  type DocsResponse,
  type DocsSelection,
  type EditOutcome,
} from './protocol';
import { collectSegments, readDocumentText } from './rectScrape';

/**
 * Main-world half of the Google Docs bridge.
 *
 * Runs at `document_start` in the page's own JS context — the only place the
 * annotation flag can be set early enough. Google evaluates it once, when the
 * editor app is constructed, so setting it after load does nothing at all. That
 * timing is the single most common way this integration is got wrong: the flag
 * looks inert, the API returns an empty object, and it reads as a permission
 * problem rather than a race.
 *
 * Two read paths, tried in order:
 *   1. `_docs_annotate_getAnnotatedText(id)` — returns text AND selection, which
 *      is what a writing agent actually needs. Undocumented.
 *   2. Scraping the annotated canvas's `rect[aria-label]` nodes — text only, but
 *      it consumes rendered output rather than internal API, and it is what
 *      Harper ships in production.
 */

declare global {
  interface Window {
    _docs_annotate_canvas_by_ext?: string;
    _docs_annotate_getAnnotatedText?: (id: string) => Promise<AnnotatedText> | AnnotatedText;
  }
}

/**
 * Shapes verified live on 2026-11-02. `getSelection` returns an ARRAY of ranges
 * (one per cursor), and `setSelection` takes two plain numbers. The first build
 * assumed an object for both, so reading the selection always came back empty
 * and setting it silently did nothing.
 */
type RawRange = { start?: number; end?: number };

interface AnnotatedText {
  getText?: () => string;
  getSelection?: () => RawRange[] | RawRange | undefined;
  setSelection?: (start: number, end: number) => void;
}

/**
 * Index 0 of `getText()` is a U+0003 document marker, and every offset Docs
 * hands out counts it. Callers outside this file see text without it, so the
 * marker is stripped on the way out and added back on the way in.
 */
const MARKER = '\u0003';

function markerOffset(raw: string): number {
  return raw.startsWith(MARKER) ? 1 : 0;
}

function firstRange(raw: RawRange[] | RawRange | undefined): RawRange | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Typing into Docs.
 *
 * Docs listens for input on an offscreen contenteditable inside
 * `.docs-texteventtarget-iframe`, and it honours a synthetic paste there — the
 * pasted text replaces whatever is selected, exactly as a real paste would, and
 * lands in the document's own undo history. Plain text only, so formatting
 * around the edit is kept and the replacement takes the style of where it lands.
 */
function paste(text: string): boolean {
  const frame = document.querySelector<HTMLIFrameElement>('.docs-texteventtarget-iframe');
  const doc = frame?.contentDocument;
  if (!doc) return false;

  const active = doc.activeElement as HTMLElement | null;
  const target =
    active?.isContentEditable === true
      ? active
      : (doc.querySelector<HTMLElement>('[contenteditable="true"]') ?? doc.body);
  if (!target) return false;

  const data = new DataTransfer();
  data.setData('text/plain', text);
  target.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
  );
  return true;
}

/**
 * Select the passage, paste over it, then read the document back to confirm the
 * new text is really there. Docs re-renders asynchronously, so the read polls
 * briefly rather than trusting the first frame.
 */
async function replace(
  api: AnnotatedText,
  find: string,
  text: string,
  near: number | undefined,
): Promise<EditOutcome> {
  if (typeof api.getText !== 'function' || typeof api.setSelection !== 'function' || typeof api.getSelection !== 'function') {
    return { applied: false, reason: 'unavailable' };
  }

  const before = api.getText();
  const offset = markerOffset(before);
  const hit = locate(before.slice(offset), find, near);
  if ('error' in hit) return { applied: false, reason: hit.error };

  api.setSelection(hit.start + offset, hit.end + offset);
  await sleep(30);
  // Selection belongs to the user too. Never paste after they moved the cursor
  // or typed while the editor was settling.
  const selected = firstRange(api.getSelection());
  if (api.getText() !== before || selected?.start !== hit.start + offset || selected.end !== hit.end + offset) {
    return { applied: false, reason: 'unavailable' };
  }
  if (!paste(text)) return { applied: false, reason: 'unavailable' };

  for (let waited = 0; waited < 1_500; waited += 50) {
    await sleep(50);
    const after = api.getText();
    if (after === before && find !== text) continue;
    const body = after.slice(markerOffset(after));
    if (normalize(body) === normalize(before.slice(offset, hit.start + offset) + text + before.slice(hit.end + offset)) && landed(body, hit.start, text)) return { applied: true, start: hit.start };
  }
  return { applied: false, reason: 'unverified' };
}

/**
 * Any non-empty string opens the gate — the value is logged to Google's
 * telemetry but never validated against a list. Using the real extension id
 * keeps that telemetry honest rather than impersonating another extension, which
 * several projects in the wild do.
 */
export function setFlag(id: string): void {
  try {
    window._docs_annotate_canvas_by_ext = id;
  } catch {
    // A frozen window or a hostile page. The rect-scrape path may still work.
  }
}

let cachedHandle: AnnotatedText | undefined;
let cachedFactory: Window['_docs_annotate_getAnnotatedText'];
let cachedUrl = '';

async function annotated(id: string): Promise<AnnotatedText | undefined> {
  const factory = window._docs_annotate_getAnnotatedText;
  if (cachedHandle && factory === cachedFactory && cachedUrl === location.href) return cachedHandle;
  cachedHandle = undefined;
  cachedFactory = factory;
  const url = location.href;
  cachedUrl = url;
  if (typeof factory !== 'function') return undefined;
  try {
    const handle = await factory(id);
    if (handle && typeof handle === 'object' && typeof handle.getText === 'function') {
      // An earlier navigation can resolve after the current document's handle.
      if (window._docs_annotate_getAnnotatedText === factory && location.href === url) {
        cachedHandle = handle;
      }
      return handle;
    }
  } catch {
    // Docs rejects outright on client-side-encrypted documents. Fall through.
  }
  return undefined;
}

async function handle(request: DocsRequest, id: string): Promise<DocsResponse> {
  switch (request.kind) {
    case 'probe': {
      const api = await annotated(id);
      return {
        kind: 'probe',
        annotatedApi: typeof api?.getText === 'function',
        rectCount: collectSegments().length,
        flagSet: window._docs_annotate_canvas_by_ext === id,
      };
    }

    case 'getText': {
      const api = await annotated(id);
      const viaApi = api?.getText?.();
      if (typeof viaApi === 'string' && viaApi.trim().length > 0) {
        return {
          kind: 'getText',
          text: viaApi.slice(markerOffset(viaApi)),
          strategy: ReadStrategy.AnnotatedApi,
        };
      }
      return { kind: 'getText', text: readDocumentText(), strategy: ReadStrategy.RectScrape };
    }

    case 'getSelection': {
      const api = await annotated(id);
      const raw = firstRange(api?.getSelection?.());
      if (!raw || typeof raw.start !== 'number' || typeof raw.end !== 'number') {
        return { kind: 'getSelection', selection: undefined };
      }
      const full = api?.getText?.() ?? '';
      const offset = markerOffset(full);
      const selection: DocsSelection = {
        start: Math.max(0, raw.start - offset),
        end: Math.max(0, raw.end - offset),
        text: full.slice(raw.start, raw.end),
      };
      return { kind: 'getSelection', selection };
    }

    case 'setSelection': {
      const api = await annotated(id);
      if (typeof api?.setSelection !== 'function') {
        return { kind: 'setSelection', applied: false };
      }
      const offset = markerOffset(api.getText?.() ?? '');
      api.setSelection(request.start + offset, request.end + offset);
      return { kind: 'setSelection', applied: true };
    }

    case 'replace': {
      const api = await annotated(id);
      if (!api) return { kind: 'replace', outcome: { applied: false, reason: 'unavailable' } };
      return { kind: 'replace', outcome: await replace(api, request.find, request.text, request.near) };
    }

    default:
      return { kind: 'error', requestKind: 'probe', message: 'Unknown request' };
  }
}

/** Install the request listener. Call once, at document_start. */
export function installBridge(id: string): void {
  document.addEventListener(EVENT_REQUEST, (event: Event) => {
    const detail = (event as CustomEvent).detail as unknown;
    if (!isRequestMessage(detail)) return;

    void handle(detail.request, id)
      .catch(
        (error: unknown): DocsResponse => ({
          kind: 'error',
          requestKind: detail.request.kind,
          message: error instanceof Error ? error.message : String(error),
        }),
      )
      .then((response) => {
        document.dispatchEvent(
          new CustomEvent(EVENT_RESPONSE, {
            detail: { protocol: PROTOCOL, requestId: detail.requestId, response },
          }),
        );
      });
  });
}
