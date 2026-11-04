import { expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { auditStructure } from '../src/agent/structure';
it('does not turn a provider failure into a clean structure report', async () => {
  const error = new Error('Network unavailable');
  const client = { messages: { create: vi.fn().mockRejectedValue(error) } } as unknown as Anthropic;
  await expect(auditStructure(client, 'document', [
    { kind: 'promise', detail: 'Three points', evidence: [] },
  ])).rejects.toThrow('Network unavailable');
});
it('rejects malformed model judgements instead of presenting them as clean', async () => {
  const client = { messages: { create: vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: '{"ok":"false","confidence":"certain"}' }],
  }) } } as unknown as Anthropic;
  await expect(auditStructure(client, 'document', [
    { kind: 'promise', detail: 'Three points', evidence: [] },
  ])).rejects.toThrow('valid structure');
});
