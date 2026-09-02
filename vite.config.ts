import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFileSync, existsSync } from 'node:fs';

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

/**
 * Copies manifest.json from the project root into dist/ after each build.
 * Vite's root is `src/`, so static files referenced by the manifest
 * (icons) come from public/, but manifest.json itself must live at
 * dist/ root for Chrome's "Load unpacked" flow.
 */
function copyManifest(): Plugin {
  return {
    name: 'copy-manifest',
    closeBundle(): void {
      const src = r('./manifest.json');
      const dest = r('./dist/manifest.json');
      if (existsSync(src)) {
        copyFileSync(src, dest);
      }
    },
  };
}

export default defineConfig({
  root: r('./src'),
  publicDir: r('./public'),
  plugins: [react(), copyManifest()],
  build: {
    outDir: r('./dist'),
    emptyOutDir: true,
    modulePreload: false,
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: r('./src/popup/index.html'),
        options: r('./src/options/index.html'),
        // ES module service worker — "type": "module" in manifest.json
        // allows Rollup code-splitting with relative imports at runtime.
        'background/service-worker': r('./src/background/service-worker.ts'),
      },
      output: {
        // Namespaced entries (background/service-worker) keep their folder
        // path so manifest.json references stay stable. Popup/options
        // entries are emitted from their HTML files, not here.
        entryFileNames: (chunk) =>
          chunk.name && chunk.name.includes('/')
            ? '[name].js'
            : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
  test: {
    // Forward slashes are required for glob matching on Windows; the path
    // is relative to the vite root (src/), so "../tests" is project/tests.
    include: ['../tests/**/*.test.ts'],
    environment: 'node',
  },
});
