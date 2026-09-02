import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

/**
 * Separate build for the content script.
 *
 * MV3 content scripts cannot be ES modules: they are injected as plain
 * scripts, so `import` statements would fail. This config bundles the
 * content script (and everything it imports) into ONE self-contained
 * IIFE file at dist/content/content-script.js.
 */
export default defineConfig({
  build: {
    outDir: r('./dist'),
    emptyOutDir: false,
    sourcemap: false,
    modulePreload: false,
    rollupOptions: {
      input: r('./src/content/content-script.ts'),
      output: {
        format: 'iife',
        entryFileNames: 'content/content-script.js',
        inlineDynamicImports: true,
      },
    },
  },
});
