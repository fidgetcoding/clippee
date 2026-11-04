import { expect, it } from 'vitest';
import { isRequestMessage, isResponseMessage, PROTOCOL } from '../src/docs/protocol';
it('rejects malformed bridge operations before they reach selection or paste', () => {
  const wrap = (request: unknown) => ({ protocol: PROTOCOL, requestId: 'id', request });
  expect(isRequestMessage(wrap({ kind: 'replace', find: 42, text: 'x' }))).toBe(false);
  expect(isRequestMessage(wrap({ kind: 'setSelection', start: -1, end: 2 }))).toBe(false);
  expect(isRequestMessage(wrap({ kind: 'setSelection', start: 2, end: 1 }))).toBe(false);
  expect(isRequestMessage(wrap({ kind: 'deleteEverything' }))).toBe(false);
  expect(isResponseMessage({ protocol: PROTOCOL, requestId: 'id', response: {
    kind: 'replace', outcome: { applied: 'yes' },
  } })).toBe(false);
});
