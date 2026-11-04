import { expect, it, vi } from 'vitest';
import { exportText } from '../src/corpus/drive';
it('does not overwrite cached writing with empty text on a failed Drive export', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
  try { await expect(exportText('test-token', 'test-doc')).rejects.toThrow('503'); }
  finally { vi.unstubAllGlobals(); }
});
