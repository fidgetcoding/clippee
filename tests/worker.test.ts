import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  listener: undefined as undefined | ((message: unknown, sender: object, reply: (v: unknown) => void) => boolean),
  ask: vi.fn(async () => ({ ok: true, text: 'reply' })),
  settings: vi.fn(async () => ({ apiKey: 'test-key', workspaceId: '' })),
}));
vi.mock('../src/platform', () => ({ ext: {
  runtime: { onMessage: { addListener: (fn: typeof state.listener) => { state.listener = fn; } } },
} }));
vi.mock('../src/settings', () => ({ loadSettings: state.settings }));
vi.mock('../src/agent/client', () => ({ ask: state.ask, NO_KEY: 'no key', clientFor: vi.fn(),
  describe: (e: unknown) => ({ error: e instanceof Error ? e.message : 'error' }),
}));
it('replies to malformed asks without entering the provider', async () => {
  await import('../src/background/serviceWorker');
  const reply = vi.fn();
  state.listener!({ type: 'mrclippy:ask', question: 'hello' }, {}, reply);
  await vi.waitFor(() => expect(reply).toHaveBeenCalled());
  expect(reply.mock.calls[0]?.[0]).toMatchObject({ ok: false });
  expect(state.ask).not.toHaveBeenCalled();
});
it('returns storage failures once instead of leaving the message channel hanging', async () => {
  const reply = vi.fn();
  state.settings.mockRejectedValueOnce(new Error('Storage unavailable'));
  state.listener!({ type: 'mrclippy:has-key' }, {}, reply);
  await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
  expect(reply.mock.calls[0]?.[0]).toEqual({ ok: false, error: 'Storage unavailable' });
});
