import {
  EVENT_REQUEST,
  EVENT_RESPONSE,
  PROTOCOL,
  ReadStrategy,
  isRequestMessage,
  type DocsRequest,
  type DocsResponse,
  type DocsSelection,
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

interface AnnotatedText {
  getText?: () => string;
  getSelection?: () => { start?: number; end?: number } | undefined;
  setSelection?: (selection: { start: number; end: number }) => void;
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

async function annotated(id: string): Promise<AnnotatedText | undefined> {
  if (cachedHandle) return cachedHandle;
  const factory = window._docs_annotate_getAnnotatedText;
  if (typeof factory !== 'function') return undefined;
  try {
    const handle = await factory(id);
    if (handle && typeof handle === 'object') {
      cachedHandle = handle;
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
        return { kind: 'getText', text: viaApi, strategy: ReadStrategy.AnnotatedApi };
      }
      return { kind: 'getText', text: readDocumentText(), strategy: ReadStrategy.RectScrape };
    }

    case 'getSelection': {
      const api = await annotated(id);
      const raw = api?.getSelection?.();
      if (!raw || typeof raw.start !== 'number' || typeof raw.end !== 'number') {
        return { kind: 'getSelection', selection: undefined };
      }
      const text = api?.getText?.() ?? '';
      const selection: DocsSelection = {
        start: raw.start,
        end: raw.end,
        text: text.slice(raw.start, raw.end),
      };
      return { kind: 'getSelection', selection };
    }

    case 'setSelection': {
      const api = await annotated(id);
      if (typeof api?.setSelection !== 'function') {
        return { kind: 'setSelection', applied: false };
      }
      api.setSelection({ start: request.start, end: request.end });
      return { kind: 'setSelection', applied: true };
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
