import { expect, it, vi } from 'vitest';
import { ChatPanel, type AgentChange } from '../src/content/chatPanel';
import type { ChatTurn, DocumentEdit } from '../src/agent/types';
const flush = () => new Promise((r) => setTimeout(r, 0));
function panel(patch: Partial<ConstructorParameters<typeof ChatPanel>[0]> = {}) {
  return new ChatPanel({ findings: [], onAsk: async () => ({ text: '' }), onAudit: async () => '',
    onDismissFinding: () => {}, onClose: () => {}, onSettings: () => {}, ...patch });
}
it('does not send a failed audit placeholder as prior assistant advice', async () => {
  const onAsk = vi.fn(async (_question: string, _history: readonly ChatTurn[]) => ({ text: 'answer' }));
  const p = panel({ onAsk, onAudit: async () => { throw new Error('offline'); } });
  [...p.el.querySelectorAll<HTMLButtonElement>('.mrclippy-chip')].find((b) => b.textContent === 'Check my structure')!.click();
  await flush();
  p.el.querySelector('textarea')!.value = 'try something else';
  p.el.querySelector('form')!.requestSubmit();
  await flush();
  expect(onAsk.mock.calls[0]?.[1]).toEqual([]);
  p.dispose();
});
it('excludes ignored notes from Fix all', async () => {
  const onApply = vi.fn(async (edits: readonly DocumentEdit[]): Promise<AgentChange[]> => edits.map((e) => ({ ...e, applied: true })));
  const onAsk = vi.fn(async (q: string) => ({ text: 'draft', proposals: [{ find: q.includes('Ignore me') ? 'ignored' : q.includes('Second') ? 'two' : 'three', replace: 'fixed' }] }));
  const p = panel({ findings: [
    { text: 'Ignore me', anchor: 'one' }, { text: 'Second', anchor: 'two' }, { text: 'Third', anchor: 'three' },
  ], onAsk, onApply });
  p.el.querySelector<HTMLButtonElement>('.mrclippy-dismiss')!.click();
  p.el.querySelector<HTMLButtonElement>('.mrclippy-fixall button')!.click();
  for (let i = 0; i < 8; i++) await flush();
  expect(onApply.mock.calls.flatMap((args) => args[0]).map((e) => e.find)).toEqual(['two', 'three']);
  p.dispose();
});
