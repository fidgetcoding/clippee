import { ext } from '../platform';

/**
 * Opening the toolbar popup also calls him back to the page now, when he is
 * away. Settings opened as its own window (it carries `?host=`) is not a
 * toolbar click, and its active tab is the window itself, so it asks nothing.
 */
export async function summonOnActiveTab(search = location.search): Promise<void> {
  if (new URLSearchParams(search).has('host')) return;
  try {
    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return;
    await ext.tabs.sendMessage(tab.id, { type: 'mrclippy:summon' });
  } catch {
    // No Clippee on this tab: a chrome:// page, a PDF, a site he doesn't run on.
  }
}
