import { describe, expect, it } from 'vitest';
import { review } from '../src/checks';

const para =
  'PANEL 6 THE STORM. The keepers climb the spiral stairs while the foghorn sounds over ' +
  'the harbour. Rain hammers the lantern glass as Marisol trims the lampwick, and Bram ' +
  'rows out past the breakwater with a coil of rope. Gulls hang in the wind instead ' +
  'of flying, and the beam sweeps the water every twelve seconds.\n\n';

describe('review at real document sizes', () => {
  for (const pages of [5, 25, 60]) {
    it(`${pages} pages stays responsive`, () => {
      const doc = para.repeat(pages * 4);
      const wordCount = doc.split(/\s+/).filter(Boolean).length;
      const t = performance.now();
      const found = review(doc);
      const ms = performance.now() - t;
      console.log(`  ${pages}pp / ~${wordCount} words → ${ms.toFixed(0)}ms, ${found.length} findings`);
      expect(ms).toBeLessThan(30_000);
    });
  }
});
