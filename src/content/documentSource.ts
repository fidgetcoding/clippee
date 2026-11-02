import { DocsBridgeClient } from '../docs/bridgeClient';

/**
 * Where Mr. Clippy gets the text he is reasoning about.
 *
 * An interface because the paths are genuinely different. A normal page hands
 * over `innerText`. Google Docs renders body text to `<canvas>`, so there is no
 * DOM text at all and the content arrives through a main-world bridge over an
 * undocumented annotation hook — which Google logs, and could close in a single
 * release. Keeping that behind a source means the Docs REST API can be dropped
 * in as a live fallback by adding a file rather than rewriting call sites.
 */
export interface DocumentSource {
  readonly id: string;
  /** True when this source can handle the current page. */
  matches(): boolean;
  /** Full document text, or undefined if it cannot be read right now. */
  read(): Promise<string | undefined>;
  /** Human-readable reason `read()` returned nothing. Shown in the balloon. */
  explainFailure?(): string;
  dispose?(): void;
}

/** Generic web page: whatever the DOM says. Works everywhere except Docs. */
export const domSource: DocumentSource = {
  id: 'dom',
  matches: () => true,
  read: async () => {
    // Prefer the main content region: page chrome, nav and footers are somebody
    // else's prose and would pollute every document-level statistic.
    const main = document.querySelector<HTMLElement>('main, article, [role="main"]');
    const text = (main ?? document.body)?.innerText ?? '';
    return text.trim().length > 0 ? text : undefined;
  },
  explainFailure: () => "There's nothing here I can read.",
};

export function createDocsSource(): DocumentSource {
  let client: DocsBridgeClient | undefined;
  let lastFailure = 'I can’t read this document.';

  const ensureClient = (): DocsBridgeClient => {
    client ??= new DocsBridgeClient();
    return client;
  };

  return {
    id: 'google-docs',

    matches: () =>
      location.hostname === 'docs.google.com' && location.pathname.includes('/document/'),

    read: async () => {
      const text = await ensureClient().getText();
      if (text) return text;

      // Distinguish the failure modes — they need different fixes, and "it
      // didn't work" is useless to whoever is debugging it.
      const probe = await ensureClient().probe();
      if (!probe) {
        lastFailure = 'My Docs bridge never loaded. Reloading the tab usually fixes it.';
      } else if (!probe.flagSet) {
        lastFailure = 'I loaded too late to read this document. Reload the tab.';
      } else if (!probe.annotatedApi && probe.rectCount === 0) {
        lastFailure = 'Google is not exposing this document to me. It may be encrypted.';
      } else {
        lastFailure = 'This document looks empty to me.';
      }
      return undefined;
    },

    explainFailure: () => lastFailure,

    dispose: () => {
      client?.dispose();
      client = undefined;
    },
  };
}

export function resolveSource(): DocumentSource {
  const docs = createDocsSource();
  return docs.matches() ? docs : domSource;
}
