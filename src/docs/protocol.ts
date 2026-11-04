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

/** A replace waits for Docs to re-render before it can verify, so it gets longer. */
export const REPLACE_TIMEOUT_MS = 4_000;

export type DocsRequest =
  | { kind: 'getText' }
  | { kind: 'getSelection' }
  | { kind: 'setSelection'; start: number; end: number }
  | { kind: 'replace'; find: string; text: string; near?: number }
  | { kind: 'probe' };

/** Why an edit did not land. Each one reads differently to the user. */
export type EditFailure =
  | 'not-found'
  | 'ambiguous'
  | 'unavailable'
  | 'unverified';

export type EditOutcome =
  | { readonly applied: true; readonly start: number }
  | { readonly applied: false; readonly reason: EditFailure };

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
  | { kind: 'replace'; outcome: EditOutcome }
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
    validRequest(value.request)
  );
}

export function isResponseMessage(value: unknown): value is ResponseMessage {
  return (
    isRecord(value) &&
    value.protocol === PROTOCOL &&
    typeof value.requestId === 'string' &&
    isRecord(value.response) &&
    validResponse(value.response)
  );
}

function index(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validRequest(value: Record<string, unknown>): boolean {
  switch (value.kind) {
    case 'getText': case 'getSelection': case 'probe': return true;
    case 'setSelection': return index(value.start) && index(value.end) && value.end >= value.start;
    case 'replace': return typeof value.find === 'string' && typeof value.text === 'string' &&
      (value.near === undefined || index(value.near));
    default: return false;
  }
}

function validResponse(value: Record<string, unknown>): boolean {
  switch (value.kind) {
    case 'getText': return typeof value.text === 'string' &&
      (value.strategy === ReadStrategy.AnnotatedApi || value.strategy === ReadStrategy.RectScrape);
    case 'getSelection': {
      const s = value.selection;
      return s === undefined || (isRecord(s) && index(s.start) && index(s.end) &&
        s.end >= s.start && typeof s.text === 'string');
    }
    case 'setSelection': return typeof value.applied === 'boolean';
    case 'replace': {
      const o = value.outcome;
      return isRecord(o) && (o.applied === true ? index(o.start) :
        o.applied === false && ['not-found', 'ambiguous', 'unavailable', 'unverified'].includes(String(o.reason)));
    }
    case 'probe': return typeof value.annotatedApi === 'boolean' &&
      typeof value.flagSet === 'boolean' && index(value.rectCount);
    case 'error': return typeof value.message === 'string' &&
      ['getText', 'getSelection', 'setSelection', 'replace', 'probe'].includes(String(value.requestKind));
    default: return false;
  }
}
