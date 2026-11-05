import { matchesPattern } from '../matchPattern';
import { ext } from '../platform';

export { matchesPattern };

/** What the tab says about him, or that nobody on it answered. */
export type TabPresence = { readonly here: boolean } | 'missing';

/** The page patterns his content script runs on, from the manifest that is loaded. */
function contentMatches(): string[] {
  return (ext.runtime.getManifest().content_scripts ?? []).flatMap((cs) => cs.matches ?? []);
}

export function isHisPage(url: string | undefined): boolean {
  return contentMatches().some((p) => matchesPattern(url, p));
}

/**
 * The tab the button is about: the active one, or, when Settings was opened
 * from Options (whose own tab is chrome://extensions), the doc used last.
 */
export async function targetTab(): Promise<chrome.tabs.Tab | undefined> {
  const [active] = await ext.tabs.query({ active: true, currentWindow: true });
  if (active && isHisPage(active.url)) return active;
  const docs = (await ext.tabs.query({})).filter((t) => isHisPage(t.url));
  return docs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
}

/** Ask the tab whether he's there. No answer means no live Clippee on it. */
export async function askTab(tabId: number): Promise<TabPresence> {
  try {
    const reply = (await ext.tabs.sendMessage(tabId, { type: 'mrclippy:presence' })) as { here?: unknown } | undefined;
    return typeof reply?.here === 'boolean' ? { here: reply.here } : 'missing';
  } catch {
    return 'missing';
  }
}

/**
 * The button. Show or Hide resets him outright on the tab, whatever he was
 * stuck in. With nobody answering on the tab (an extension reload leaves open
 * docs with a dead copy), the worker puts a fresh one in, and he makes his
 * entrance. Resolves to where he is after.
 */
export async function setPresence(tabId: number, show: boolean, now: TabPresence): Promise<TabPresence> {
  if (now !== 'missing') {
    try {
      const reply = (await ext.tabs.sendMessage(tabId, { type: show ? 'mrclippy:force-show' : 'mrclippy:force-hide' })) as
        | { here?: unknown }
        | undefined;
      if (typeof reply?.here === 'boolean') return { here: reply.here };
    } catch {
      // Gone since the popup opened: put a fresh one in below.
    }
  }
  if (!show) return 'missing';
  await ext.runtime.sendMessage({ type: 'mrclippy:inject', tabId });
  return { here: true };
}
