import { expect, it, vi } from 'vitest';
import { DocsBridgeClient } from '../src/docs/bridgeClient';
import { EVENT_REQUEST, EVENT_RESPONSE, PROTOCOL, type RequestMessage } from '../src/docs/protocol';
it('correlates replies across clients created in the same millisecond', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(123);
  const requests: RequestMessage[] = [];
  const capture = (e: Event) => requests.push((e as CustomEvent<RequestMessage>).detail);
  document.addEventListener(EVENT_REQUEST, capture);
  const a = new DocsBridgeClient(), b = new DocsBridgeClient();
  const reads = [a.getText(), b.getText()];
  requests.forEach((request, i) => document.dispatchEvent(new CustomEvent(EVENT_RESPONSE, {
    detail: { protocol: PROTOCOL, requestId: request.requestId,
      response: { kind: 'getText', text: i === 0 ? 'first' : 'second', strategy: 'annotated-api' } },
  })));
  const results = await Promise.all(reads);
  a.dispose(); b.dispose(); document.removeEventListener(EVENT_REQUEST, capture); vi.restoreAllMocks();
  expect(results).toEqual(['first', 'second']);
});
