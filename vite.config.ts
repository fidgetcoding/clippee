import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest.config.ts';

const isFirefox = process.env.TARGET_BROWSER === 'firefox';

export default defineConfig({
  plugins: [crx({ manifest, browser: isFirefox ? 'firefox' : 'chrome' })],
  build: {
    outDir: isFirefox ? 'dist-firefox' : 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  // crxjs serves the extension over a fixed port during dev; a random port breaks
  // the HMR client injected into content scripts.
  server: { port: 5173, strictPort: true, hmr: { port: 5173 } },
});
