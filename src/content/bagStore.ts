import { isBag, type BagStore } from '../character/shuffleBag';
import { ext } from '../platform';
import { STORAGE_TIMEOUT_MS, within } from '../timeout';

/**
 * A shuffle bag kept in storage.local, so its place carries across tabs and
 * reloads. Reading gives up after a moment and writing never waits: a bag
 * that can't reach storage just lives for the page.
 */
export function storageBag(key: string): BagStore {
  return {
    load: async () => {
      const stored = await within(() => ext.storage.local.get(key), STORAGE_TIMEOUT_MS);
      const value = stored?.[key];
      return isBag(value) ? value : undefined;
    },
    save: (state) => {
      try {
        void ext.storage.local.set({ [key]: state }).catch(() => undefined);
      } catch {
        // A dead extension context: the in-page bag carries on.
      }
    },
  };
}
