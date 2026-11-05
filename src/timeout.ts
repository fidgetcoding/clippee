/**
 * How long anything waits on extension storage before carrying on without it.
 * A storage call in flight while the extension reloads never settles; nothing
 * of his may wait on one for good.
 */
export const STORAGE_TIMEOUT_MS = 400;

/**
 * The result of `work`, or undefined once `ms` passes, it rejects, or it
 * throws on the spot (a dead extension context does). Never hangs.
 */
export function within<T>(work: Promise<T> | (() => Promise<T>), ms: number): Promise<T | undefined> {
  let pending: Promise<T>;
  try {
    pending = typeof work === 'function' ? work() : work;
  } catch {
    return Promise.resolve(undefined);
  }
  return new Promise<T | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    Promise.resolve(pending).then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(undefined); },
    );
  });
}
