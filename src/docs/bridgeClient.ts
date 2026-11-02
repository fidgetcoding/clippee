import {
  DEFAULT_TIMEOUT_MS,
  EVENT_REQUEST,
  EVENT_RESPONSE,
  PROTOCOL,
  isResponseMessage,
  type DocsRequest,
  type DocsResponse,
  type DocsSelection,
} from './protocol';

interface Pending {
  readonly resolve: (response: DocsResponse) => void;
  readonly reject: (reason: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * Isolated-world client for the Docs bridge.
 *
 * Every call is timed out. The main-world half may simply not be there — the
 * page could have loaded before the extension, the flag could have been set too
 * late, or Google could have closed the hook between one release and the next —
 * and a bridge that hangs forever would leave Mr. Clippy silently frozen rather than
 * degrading to "I can't read this".
 */
export class DocsBridgeClient {
  private readonly pending = new Map<string, Pending>();
  private readonly onResponse: EventListener;
  private seq = 0;

  constructor(
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
    private readonly target: Document = document,
  ) {
    this.onResponse = (event: Event): void => {
      const detail = (event as CustomEvent).detail as unknown;
      if (!isResponseMessage(detail)) return;

      const pending = this.pending.get(detail.requestId);
      if (!pending) return;

      this.pending.delete(detail.requestId);
      clearTimeout(pending.timer);

      if (detail.response.kind === 'error') {
        pending.reject(new Error(detail.response.message));
        return;
      }
      pending.resolve(detail.response);
    };

    this.target.addEventListener(EVENT_RESPONSE, this.onResponse);
  }

  dispose(): void {
    this.target.removeEventListener(EVENT_RESPONSE, this.onResponse);
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Docs bridge request ${id} disposed`));
    }
    this.pending.clear();
  }

  /** Is the main-world half present, and which read paths are live? */
  async probe(): Promise<{ annotatedApi: boolean; rectCount: number; flagSet: boolean } | undefined> {
    try {
      const response = await this.send({ kind: 'probe' });
      return response.kind === 'probe' ? response : undefined;
    } catch {
      return undefined;
    }
  }

  async getText(): Promise<string | undefined> {
    try {
      const response = await this.send({ kind: 'getText' });
      if (response.kind !== 'getText') return undefined;
      return response.text.trim().length > 0 ? response.text : undefined;
    } catch {
      return undefined;
    }
  }

  async getSelection(): Promise<DocsSelection | undefined> {
    try {
      const response = await this.send({ kind: 'getSelection' });
      return response.kind === 'getSelection' ? response.selection : undefined;
    } catch {
      return undefined;
    }
  }

  async setSelection(start: number, end: number): Promise<boolean> {
    try {
      const response = await this.send({ kind: 'setSelection', start, end });
      return response.kind === 'setSelection' && response.applied;
    } catch {
      return false;
    }
  }

  private send(request: DocsRequest): Promise<DocsResponse> {
    const requestId = `mr-clippy-${Date.now()}-${++this.seq}`;

    return new Promise<DocsResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Docs bridge "${request.kind}" timed out`));
      }, this.timeoutMs);

      this.pending.set(requestId, { resolve, reject, timer });
      this.target.dispatchEvent(
        new CustomEvent(EVENT_REQUEST, { detail: { protocol: PROTOCOL, requestId, request } }),
      );
    });
  }
}
