import { describe, expect, it } from 'vitest';
import { segmentsToText, toLines, type RectSegment } from '../src/docs/rectScrape';
import { DocsBridgeClient } from '../src/docs/bridgeClient';
import { EVENT_REQUEST, EVENT_RESPONSE, PROTOCOL, isRequestMessage } from '../src/docs/protocol';

function rect(text: string, x: number, y: number, width = text.length * 7, height = 14): RectSegment {
  return { text, x, y, width, height };
}

describe('rect reconstruction', () => {
  it('rebuilds reading order from paint order', () => {
    // Docs emits rects in whatever order it painted them. Reading order has to
    // come back from geometry alone.
    const segments = [rect('world', 60, 30), rect('Hello', 10, 10), rect('again', 10, 30), rect('there', 60, 10)];
    expect(segmentsToText(segments)).toBe('Hello there\nagain world');
  });

  it('groups runs of different font size onto one line', () => {
    // A 24px heading fragment and 14px body text share a baseline but not a top
    // edge, so banding is on the vertical centre rather than y.
    const big = { text: 'BIG', x: 10, y: 6, width: 40, height: 24 };
    const small = { text: 'small', x: 60, y: 12, width: 30, height: 14 };
    expect(toLines([big, small])).toHaveLength(1);
  });

  it('inserts a space only when the visual gap warrants one', () => {
    const tight = [rect('un', 10, 10, 14), rect('happy', 24, 10)];
    expect(segmentsToText(tight)).toBe('unhappy');

    const spaced = [rect('one', 10, 10, 20), rect('two', 60, 10)];
    expect(segmentsToText(spaced)).toBe('one two');
  });

  it('does not double a space that is already there', () => {
    const segments = [rect('one ', 10, 10, 24), rect('two', 60, 10)];
    expect(segmentsToText(segments)).toBe('one two');
  });

  it('returns empty string for no rects rather than throwing', () => {
    expect(segmentsToText([])).toBe('');
  });

  it('collapses runs of blank lines', () => {
    const segments = [rect('top', 10, 10), rect('bottom', 10, 200)];
    expect(segmentsToText(segments)).toBe('top\nbottom');
  });
});

describe('bridge client', () => {
  /** Stand in for the main-world half. */
  function installFakeBridge(respond: (kind: string) => unknown): () => void {
    const listener = (event: Event): void => {
      const detail = (event as CustomEvent).detail as unknown;
      if (!isRequestMessage(detail)) return;
      document.dispatchEvent(
        new CustomEvent(EVENT_RESPONSE, {
          detail: {
            protocol: PROTOCOL,
            requestId: detail.requestId,
            response: respond(detail.request.kind),
          },
        }),
      );
    };
    document.addEventListener(EVENT_REQUEST, listener);
    return () => document.removeEventListener(EVENT_REQUEST, listener);
  }

  it('round-trips a text request', async () => {
    const uninstall = installFakeBridge(() => ({
      kind: 'getText',
      text: 'the document body',
      strategy: 'annotated-api',
    }));
    const client = new DocsBridgeClient();

    await expect(client.getText()).resolves.toBe('the document body');

    client.dispose();
    uninstall();
  });

  it('treats an empty document as unreadable rather than as empty text', async () => {
    const uninstall = installFakeBridge(() => ({ kind: 'getText', text: '   ', strategy: 'rect-scrape' }));
    const client = new DocsBridgeClient();

    await expect(client.getText()).resolves.toBeUndefined();

    client.dispose();
    uninstall();
  });

  it('resolves undefined when no main-world half answers', async () => {
    // The most likely production failure: the page loaded before the extension,
    // so the flag was never set. Clippee must degrade, not hang.
    const client = new DocsBridgeClient(30);
    await expect(client.getText()).resolves.toBeUndefined();
    client.dispose();
  });

  it('surfaces a bridge error as undefined rather than rejecting', async () => {
    const uninstall = installFakeBridge(() => ({
      kind: 'error',
      requestKind: 'getText',
      message: 'encrypted document',
    }));
    const client = new DocsBridgeClient();

    await expect(client.getText()).resolves.toBeUndefined();

    client.dispose();
    uninstall();
  });

  it('rejects pending requests on dispose instead of leaking them', async () => {
    const client = new DocsBridgeClient(5_000);
    const pending = client.getText();
    client.dispose();
    await expect(pending).resolves.toBeUndefined();
  });
});

it('does not dispatch new bridge requests after disposal', async () => {
  const target = document.implementation.createHTMLDocument();
  let requests = 0;
  target.addEventListener(EVENT_REQUEST, () => { requests++; });
  const client = new DocsBridgeClient(30, target);
  client.dispose();
  expect(await client.getText()).toBeUndefined();
  expect(requests).toBe(0);
});
