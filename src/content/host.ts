import styles from './styles.css?inline';

const HOST_ID = 'mrclippy-host';

export interface Host {
  readonly root: ShadowRoot;
  readonly container: HTMLElement;
  destroy(): void;
}

/**
 * Mounts Mr. Clippy inside an open shadow root.
 *
 * Open rather than closed on purpose: closed mode buys obscurity, not security —
 * a hostile page can still find the host element — while making our own debugging
 * materially worse.
 *
 * The host itself is `pointer-events: none` and children opt back in, so the page
 * underneath stays fully clickable everywhere except on Mr. Clippy himself. That is
 * the browser equivalent of the per-pixel click-through problem that rules out
 * Electron for the eventual native shell.
 */
export function mountHost(): Host {
  document.getElementById(HOST_ID)?.remove();

  const container = document.createElement('div');
  container.id = HOST_ID;
  container.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;';

  const root = container.attachShadow({ mode: 'open' });

  const sheet = document.createElement('style');
  sheet.textContent = `${styles}\n.mrclippy-agent,.mrclippy-balloon{pointer-events:auto;}`;
  root.appendChild(sheet);

  document.documentElement.appendChild(container);

  return {
    root,
    container,
    destroy: () => container.remove(),
  };
}
