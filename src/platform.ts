/**
 * The extension API, resolved once.
 *
 * Firefox exposes promise-based APIs on `browser`; its `chrome` alias is
 * callback-style. Chrome 148+ exposes `browser` natively, so preferring it and
 * falling back to `chrome` gives one promise-based surface on both without the
 * archived `webextension-polyfill`.
 */
interface ExtensionGlobals {
  browser?: typeof chrome;
  chrome?: typeof chrome;
}

const globals = globalThis as typeof globalThis & ExtensionGlobals;

/**
 * Read through `globalThis` rather than the bare `chrome` identifier. A bare
 * reference throws `ReferenceError` at module-evaluation time anywhere the API
 * is absent — a test runner, a build script, a plain page — which would take the
 * whole module graph down before any guard could run.
 */
export const ext: typeof chrome = (globals.browser ?? globals.chrome) as typeof chrome;

/** True when running inside an extension rather than a test or a plain page. */
export function hasExtensionApis(): boolean {
  return typeof ext?.storage !== 'undefined';
}
