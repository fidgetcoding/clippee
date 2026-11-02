/**
 * Wire protocol between the isolated-world content script and the main-world
 * bridge.
 *
 * `CustomEvent` on `document` rather than `window.postMessage`, which is the
 * pattern Harper's Google Docs integration uses (Apache-2.0). Both worlds share
 * the DOM, so a CustomEvent crosses the boundary without the origin-checking
 * ceremony postMessage needs, and without racing every other message handler on
 * the page.
 */

export const PROTOCOL = 'mr-clippy-gdocs/v1';
export const EVENT_REQUEST = 'mr-clippy:gdocs:request';
export const EVENT_RESPONSE = 'mr-clippy:gdocs:response';

export const DEFAULT_TIMEOUT_MS = 2_000;

export type DocsRequest =
  | { kind: 'getText' }
  | { kind: 'getSelection' }
  | { kind: 'setSelection'; start: number; end: number }
  | { kind: 'probe' };

export interface DocsSelection {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Which mechanism produced a result — the two paths behave differently. */
export const ReadStrategy = {
  /** `_docs_annotate_getAnnotatedText(id)`. Gives selection as well as text. */
  AnnotatedApi: 'annotated-api',
  /** Scraping `rect[aria-label]` from the annotated canvas. Text only. */
  RectScrape: 'rect-scrape',
} as const;

export type ReadStrategy = (typeof ReadStrategy)[keyof typeof ReadStrategy];

export type DocsResponse =
  | { kind: 'getText'; text: string; strategy: ReadStrategy }
  | { kind: 'getSelection'; selection: DocsSelection | undefined }
  | { kind: 'setSelection'; applied: boolean }
  | { kind: 'probe'; annotatedApi: boolean; rectCount: number; flagSet: boolean }
  | { kind: 'error'; requestKind: DocsRequest['kind']; message: string };

export interface RequestMessage {
  readonly protocol: string;
  readonly requestId: string;
  readonly request: DocsRequest;
}

export interface ResponseMessage {
  readonly protocol: string;
  readonly requestId: string;
  readonly response: DocsResponse;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

export function isRequestMessage(value: unknown): value is RequestMessage {
  return (
    isRecord(value) &&
    value.protocol === PROTOCOL &&
    typeof value.requestId === 'string' &&
    isRecord(value.request) &&
    typeof value.request.kind === 'string'
  );
}

export function isResponseMessage(value: unknown): value is ResponseMessage {
  return (
    isRecord(value) &&
    value.protocol === PROTOCOL &&
    typeof value.requestId === 'string' &&
    isRecord(value.response) &&
    typeof value.response.kind === 'string'
  );
}
