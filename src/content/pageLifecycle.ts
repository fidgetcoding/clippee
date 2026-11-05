import { ext } from '../platform';
import { isActiveOn, loadPreferences, onSettingsChanged, type Settings } from '../settings';

export interface PageRuntime {
  readonly hidden: boolean;
  update(settings: Settings): void;
  message(message: unknown): void;
  dispose(): void;
}

/** Owns page listeners for the page's lifetime, including while Clippy is off. */
export function startPageLifecycle(
  mount: (settings: Settings, current: () => boolean, hidden: boolean) => Promise<PageRuntime | undefined>,
  eligible: () => boolean,
): () => void {
  let disposed = false;
  let suspended = false;
  let restoreHidden = false;
  let revision = 0;
  let settings: Settings | undefined;
  let runtime: PageRuntime | undefined;
  let attempt: object | undefined;
  let url = location.href;

  const stopRuntime = (): void => {
    attempt = undefined;
    runtime?.dispose();
    runtime = undefined;
  };

  const reconcile = (): void => {
    if (disposed || suspended) return;
    if (url !== location.href) {
      url = location.href;
      stopRuntime();
    }
    if (!settings || !eligible() || !isActiveOn(settings, location.hostname)) {
      stopRuntime();
      return;
    }
    if (runtime) { runtime.update(settings); return; }
    if (attempt) return;
    const token = {};
    const startedAt = location.href;
    attempt = token;
    const current = (): boolean => !disposed && !suspended && attempt === token &&
      startedAt === location.href && eligible() && !!settings && isActiveOn(settings, location.hostname);
    void mount(settings, current, restoreHidden).then((mounted) => {
      if (!current()) mounted?.dispose();
      else if (mounted) {
        runtime = mounted;
        restoreHidden = false;
        runtime.update(settings!);
      }
      if (attempt === token) attempt = undefined;
      // pushState/replaceState need not emit a browser event. An async startup
      // still must discard its old URL and restart against the current one.
      if (!disposed && startedAt !== location.href) reconcile();
    }).catch((error: unknown) => {
      if (attempt !== token || disposed) return;
      attempt = undefined;
      console.warn('[clippee] failed to start:', error);
      if (startedAt !== location.href) reconcile();
    });
  };

  // Subscribe before loading: a change arriving during get() beats its snapshot.
  const stopWatching = onSettingsChanged((next) => {
    if (disposed || suspended) return;
    revision++;
    settings = next;
    reconcile();
  });
  const readPreferences = (): void => {
    const readRevision = ++revision;
    void loadPreferences().then((next) => {
      if (disposed || suspended || revision !== readRevision) return;
      settings = next;
      reconcile();
    }).catch((error: unknown) => {
      if (!disposed && !suspended && revision === readRevision) {
        console.warn('[clippee] failed to load preferences:', error);
      }
    });
  };
  readPreferences();

  const onMessage = (message: unknown): void => {
    if (disposed || suspended) return;
    reconcile();
    runtime?.message(message);
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    stopRuntime();
    stopWatching();
    ext.runtime.onMessage.removeListener(onMessage);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('popstate', reconcile);
    window.removeEventListener('hashchange', reconcile);
  };
  const onPageHide = (event: PageTransitionEvent): void => {
    if (!event.persisted) { dispose(); return; }
    if (disposed || suspended) return;
    suspended = true;
    revision++; // Invalidates every preference read from before suspension.
    if (runtime) restoreHidden = runtime.hidden;
    stopRuntime();
    settings = undefined;
  };
  const onPageShow = (event: PageTransitionEvent): void => {
    if (!event.persisted || disposed || !suspended) return;
    suspended = false;
    // The extension can change while this JS context is frozen. Never mount
    // using the old enabled/host/snooze snapshot while this fresh read is pending.
    settings = undefined;
    readPreferences();
  };
  ext.runtime.onMessage.addListener(onMessage);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('popstate', reconcile);
  window.addEventListener('hashchange', reconcile);
  return dispose;
}
