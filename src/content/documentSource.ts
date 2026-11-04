import { DocsBridgeClient } from '../docs/bridgeClient';
import type { EditOutcome } from '../docs/protocol';
import { locate } from '../docs/match';
import { FieldEditor } from './fieldEditor';
import { docsBoxes, type Box } from './highlight';

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
  /** Identifies the current editor/document across asynchronous operations. */
  context?(): unknown;
  /** True when this source can handle the current page. */
  matches(): boolean;
  /** Full document text, or undefined if it cannot be read right now. */
  read(): Promise<string | undefined>;
  /** Human-readable reason `read()` returned nothing. Shown in the balloon. */
  explainFailure?(): string;
  /** True when this source can write back into what it reads right now. */
  canEdit(): boolean;
  /**
   * Replace `find` with `text`. `near` picks between repeated matches and is
   * only passed by undo, which knows where it wrote.
   */
  replace(find: string, text: string, near?: number): Promise<EditOutcome>;
  /**
   * Select the first occurrence of `passage` in the page so the user can see
   * where a note applies — the way clicking a Docs comment selects its text.
   */
  select(passage: string): Promise<boolean>;
  /** On-screen boxes for `passage`, for the loud highlight. Empty if unknown. */
  boxes(passage: string): Box[];
  dispose?(): void;
}

/**
 * Generic web page. If you have been typing in a text box, that box is the
 * document — it is what you are writing, and the only thing he can edit.
 * Otherwise he reads the page.
 */
export function createDomSource(): DocumentSource {
  const field = new FieldEditor();

  return {
    id: 'dom',
    context: () => field.identity,
    matches: () => true,
    read: async () => {
      const typed = field.read();
      if (typed !== undefined) return typed;
      // Prefer the main content region: page chrome, nav and footers are somebody
      // else's prose and would pollute every document-level statistic.
      const main = document.querySelector<HTMLElement>('main, article, [role="main"]');
      const text = (main ?? document.body)?.innerText ?? '';
      return text.trim().length > 0 ? text : undefined;
    },
    explainFailure: () => "There's nothing here I can read.",
    canEdit: () => field.active,
    replace: async (find, text, near) => field.replace(find, text, near),
    select: async (passage) => field.select(passage),
    boxes: (passage) => field.boxes(passage),
    dispose: () => field.dispose(),
  };
}

export function createDocsSource(): DocumentSource {
  let client: DocsBridgeClient | undefined;
  let lastFailure = 'I can’t read this document.';

  const ensureClient = (): DocsBridgeClient => {
    client ??= new DocsBridgeClient();
    return client;
  };

  return {
    id: 'google-docs',
    context: () => location.href,

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

    canEdit: () => true,

    replace: (find, text, near) => ensureClient().replace(find, text, near),

    select: async (passage) => {
      const text = await ensureClient().getText();
      if (!text) return false;
      // `near: 0` takes the first occurrence instead of refusing a repeat.
      const hit = locate(text, passage, 0);
      if ('error' in hit) return false;
      return ensureClient().setSelection(hit.start, hit.end);
    },

    boxes: (passage) => docsBoxes(passage),

    dispose: () => {
      client?.dispose();
      client = undefined;
    },
  };
}

export function resolveSource(): DocumentSource {
  const docs = createDocsSource();
  return docs.matches() ? docs : createDomSource();
}
