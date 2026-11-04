import { expect, it, vi } from 'vitest';
import { DocsBridgeClient } from '../src/docs/bridgeClient';
import { installBridge } from '../src/docs/mainWorld';
it('retries an annotation factory that initially returned an unready handle', async () => {
  window._docs_annotate_getAnnotatedText = vi.fn()
    .mockResolvedValueOnce({}).mockResolvedValue({ getText: () => 'Ready now' });
  installBridge('test');
  const client = new DocsBridgeClient();
  expect(await client.getText()).toBeUndefined();
  expect(await client.getText()).toBe('Ready now');
  client.dispose();
});
it('refreshes the annotation handle when navigation changes the document URL', async () => {
  const originalUrl = location.href;
  let title = 'First document';
  window._docs_annotate_getAnnotatedText = () => {
    const snapshot = title;
    return { getText: () => snapshot };
  };
  const client = new DocsBridgeClient();
  try {
    expect(await client.getText()).toBe('First document');
    title = 'Second document';
    history.replaceState(null, '', '#second-document');
    expect(await client.getText()).toBe('Second document');
  } finally {
    client.dispose(); history.replaceState(null, '', originalUrl);
  }
});

it('does not cache a late handle from the previous document', async () => {
  const originalUrl = location.href;
  let resolveFirst!: (value: { getText: () => string }) => void;
  const first = new Promise<{ getText: () => string }>((resolve) => { resolveFirst = resolve; });
  const factory = vi.fn().mockReturnValueOnce(first).mockResolvedValue({ getText: () => 'Second document' });
  window._docs_annotate_getAnnotatedText = factory;
  const client = new DocsBridgeClient();
  try {
    const oldRead = client.getText();
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
    history.replaceState(null, '', '#late-handle-document');
    expect(await client.getText()).toBe('Second document');
    resolveFirst({ getText: () => 'First document' });
    await oldRead;
    expect(await client.getText()).toBe('Second document');
  } finally {
    client.dispose(); history.replaceState(null, '', originalUrl);
  }
});
