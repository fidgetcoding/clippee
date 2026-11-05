import { ext } from '../platform';
import { loadPreferences, onSettingsChanged, type Settings } from '../settings';

export interface PageRuntime {
  readonly hidden: boolean;
  update(settings: Settings): void;
  /** Handle a message from the extension. A defined result is the reply. */
  message(message: unknown): unknown;
  dispose(): void;
}

/** False once the extension was reloaded or removed under this copy of him. */
export function contextAlive(): boolean {
  try {
    return typeof ext.runtime?.id === 'string' && ext.runtime.id.length > 0;
  } catch {
    return false;
  }
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
    if (!settings || !eligible()) {
      stopRuntime();
      return;
    }
    if (runtime) { runtime.update(settings); return; }
    if (attempt) return;
    const token = {};
    const startedAt = location.href;
    attempt = token;
    const current = (): boolean => !disposed && !suspended && attempt === token &&
      startedAt === location.href && eligible() && !!settings;
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

  const onMessage = (message: unknown, _sender: unknown, reply?: (response: unknown) => void): void => {
    if (disposed || suspended) return;
    const type = (message as { type?: unknown } | null)?.type;
    // Settings' Show button: whatever kept him from mounting, try again now.
    if (type === 'mrclippy:force-show' && !runtime) restoreHidden = false;
    reconcile();
    let answer = runtime?.message(message);
    // Alive but not mounted (still starting, or not a page he works on): say so,
    // so Settings never mistakes this copy for a dead one and adds a second.
    if (answer === undefined && typeof type === 'string' && /^mrclippy:(presence|force-show|force-hide)$/.test(type)) {
      answer = { here: type === 'mrclippy:force-show' && attempt !== undefined };
    }
    if (answer !== undefined) reply?.(answer);
  };

  /**
   * An extension reload leaves this copy running in the page with a dead
   * connection: nothing it asks the extension for works again, and the new
   * copy gets put in beside it. A port to the worker breaks the moment that
   * happens; this copy then takes itself down, his host and timers with it.
   * The port also drops when the worker merely sleeps, so it reconnects then.
   */
  const watchContext = (): void => {
    if (disposed) return;
    let port: chrome.runtime.Port;
    try {
      port = ext.runtime.connect({ name: 'mrclippy:page' });
    } catch {
      dispose();
      return;
    }
    port.onDisconnect.addListener(() => {
      if (disposed) return;
      if (!contextAlive()) dispose();
      else setTimeout(watchContext, 1_000);
    });
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    // Each step on its own: in a dead context the extension calls throw, and
    // the page's own listeners and his host must still come off.
    const safely = (step: () => void): void => {
      try { step(); } catch { /* the extension is gone */ }
    };
    safely(stopRuntime);
    safely(stopWatching);
    safely(() => ext.runtime.onMessage.removeListener(onMessage));
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
  if (typeof ext.runtime.connect === 'function') watchContext();
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('popstate', reconcile);
  window.addEventListener('hashchange', reconcile);
  return dispose;
}
