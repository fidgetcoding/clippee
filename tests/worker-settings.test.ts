import { expect, it, vi } from 'vitest';

const PAGE = 'chrome-extension://id/src/popup/index.html';
const state = vi.hoisted(() => ({
  listener: undefined as undefined | ((message: unknown, sender: object, reply: (v: unknown) => void) => boolean),
  open: [] as { id: number; tabs: { url: string }[] }[],
  create: vi.fn(),
  update: vi.fn(async () => ({})),
}));
state.create.mockImplementation(async () => {
  state.open.push({ id: 7, tabs: [{ url: `${PAGE}?host=docs.google.com` }] });
  return { id: 7 };
});
vi.mock('../src/platform', () => ({ ext: {
  runtime: {
    onMessage: { addListener: (fn: typeof state.listener) => { state.listener = fn; } },
    getURL: (path: string) => `chrome-extension://id/${path}`,
  },
  action: { openPopup: async () => { throw new Error('not available'); } },
  windows: {
    getAll: async () => state.open,
    create: state.create,
    update: state.update,
  },
} }));
vi.mock('../src/settings', () => ({ loadSettings: async () => ({ apiKey: '', workspaceId: '' }) }));
vi.mock('../src/agent/client', () => ({ ask: vi.fn(), NO_KEY: 'no key', clientFor: vi.fn(),
  describe: () => ({ error: 'error' }),
}));

it('opens one Settings window however many fixes ask at once', async () => {
  // From a live doc: five drafts failing for want of a key opened four
  // stacked Settings windows on top of the toolbar popup.
  await import('../src/background/serviceWorker');
  const sender = { tab: { url: 'https://docs.google.com/document/d/x/edit' } };
  for (let i = 0; i < 5; i++) state.listener!({ type: 'mrclippy:open-settings' }, sender, () => {});
  await vi.waitFor(() => expect(state.create).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 0));
  expect(state.create).toHaveBeenCalledTimes(1);

  // Asked again later, the open window comes forward instead of a new one.
  state.listener!({ type: 'mrclippy:open-settings' }, sender, () => {});
  await vi.waitFor(() => expect(state.update).toHaveBeenCalledWith(7, { focused: true }));
  expect(state.create).toHaveBeenCalledTimes(1);
});
