import { defineManifest } from '@crxjs/vite-plugin';

const isFirefox = process.env.TARGET_BROWSER === 'firefox';

/**
 * Chromium and Firefox diverge in exactly two places that matter here:
 *  - background: service_worker (Chromium) vs scripts + event page (Firefox)
 *  - browser_specific_settings: required by Firefox for an unlisted signed build
 * Everything else is one manifest. Safari is deliberately out of scope — it has
 * no persistent personal-use extension mode, so it would cost a second codebase
 * plus a perpetual Apple Developer membership.
 */
export default defineManifest({
  manifest_version: 3,
  name: 'Clippee by Microshaft',
  version: '0.1.0',
  description: 'The paperclip is back, and this time he read your doc. Notes and one-click fixes for Google Docs.',

  permissions: ['storage', 'tabs'],

  // Without this key `chrome.action` is undefined, and the background script's
  // click handler silently never fires — the toolbar button appears to do
  // nothing at all.
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'Clippee by Microshaft',
  },

  // Cross-origin requests go only to the model API and the dormant Drive client.
  // Editor injection is scoped separately by content_scripts below.
  host_permissions: ['https://api.anthropic.com/*', 'https://www.googleapis.com/*'],

  background: isFirefox
    ? { scripts: ['src/background/serviceWorker.ts'], type: 'module' }
    : { service_worker: 'src/background/serviceWorker.ts', type: 'module' },

  content_scripts: [
    {
      // Document editors only. Everywhere else he was noise. `isWritingSurface`
      // makes the finer cut inside these hosts (Docs' file list, Office's Excel
      // and PowerPoint frames).
      matches: [
        '*://docs.google.com/document/d/*',
        // Word for the web: the editor is an iframe on this host.
        'https://*.officeapps.live.com/*',
        'https://www.notion.so/*',
        'https://*.notion.site/*',
      ],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
      all_frames: true,
    },
    {
      // Note the filename: crxjs keys content scripts by basename, so a second
      // entry called index.ts silently collides with src/content/index.ts and
      // fails the build with "Content script fileName is undefined".
      //
      // The Google Docs annotation flag is read once, when the editor app is
      // constructed. It has to be set in the page's own JS context before that
      // happens, which means MAIN world at document_start — anything later is
      // inert, and looks like a permissions problem rather than a race.
      matches: ['*://docs.google.com/document/*'],
      js: ['src/docs/gdocsMain.ts'],
      run_at: 'document_start',
      world: 'MAIN',
      all_frames: false,
    },
  ],

  // The sprite sheet is fetched by the content script from the extension origin,
  // so it has to be reachable from the page context.
  // Chrome resource matches require an origin-wide /* path; injection stays
  // restricted to document editors by content_scripts above.
  web_accessible_resources: [
    {
      resources: ['src/packs/*/map.png', 'src/packs/*/pack.json', 'assets/*'],
      matches: [
        '*://docs.google.com/*',
        'https://*.officeapps.live.com/*',
        'https://www.notion.so/*',
        'https://*.notion.site/*',
      ],
    },
  ],

  commands: {
    'toggle-mr-clippy': {
      suggested_key: { default: 'Alt+Shift+C' },
      description: 'Show or hide Clippee',
    },
  },

  ...(isFirefox
    ? {
        browser_specific_settings: {
          // world: 'MAIN' content scripts need a recent Firefox; 128 is the safe floor.
          gecko: { id: 'mr-clippy@lorecraft.io', strict_min_version: '128.0' },
        },
      }
    : {}),
});
