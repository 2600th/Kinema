import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve the Rapier ESM entry dynamically from its package.json "module" field
// so the alias survives across Rapier versions (e.g. 0.17 uses rapier.es.js,
// 0.19+ uses rapier.mjs). Uses readFileSync because 0.19 restricts subpath exports.
const rapierPkgDir = resolve(__dirname, 'node_modules/@dimforge/rapier3d-compat');
const rapierPkg = JSON.parse(readFileSync(resolve(rapierPkgDir, 'package.json'), 'utf-8'));
const rapierESM = resolve(rapierPkgDir, rapierPkg.module ?? rapierPkg.main);

export default defineConfig({
  plugins: [],
  server: {
    strictPort: true,
  },
  test: {
    environment: 'node',
    // Playwright tests live in tests/ and run via npx playwright test
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    alias: {
      // Rapier's CJS entry uses CommonJS exports which vitest can't load
      // directly. Point to the ESM entry resolved from the package metadata.
      '@dimforge/rapier3d-compat': rapierESM,
    },
  },
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@physics': resolve(__dirname, 'src/physics'),
      '@character': resolve(__dirname, 'src/character'),
      '@camera': resolve(__dirname, 'src/camera'),
      '@level': resolve(__dirname, 'src/level'),
      '@input': resolve(__dirname, 'src/input'),
      '@interaction': resolve(__dirname, 'src/interaction'),
      '@ui': resolve(__dirname, 'src/ui'),
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@audio': resolve(__dirname, 'src/audio'),
      '@vehicle': resolve(__dirname, 'src/vehicle'),
      '@editor': resolve(__dirname, 'src/editor'),
      '@navigation': resolve(__dirname, 'src/navigation'),
      '@juice': resolve(__dirname, 'src/juice'),
      '@systems': resolve(__dirname, 'src/systems'),
    },
  },
  build: {
    target: 'esnext',
    // Vite 8 uses Rolldown under the hood; rolldownOptions replaces the
    // deprecated rollupOptions compat layer.  codeSplitting.groups replaces
    // the deprecated manualChunks function form.
    // TSL display nodes (three/addons/tsl/display/*) are dynamically imported
    // by the post-processing pipeline — Rolldown keeps them as separate async
    // chunks automatically, so the negative lookahead in the vendor-three
    // regex excludes them from the vendor bundle.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vendor-three',
              test: /node_modules[\\/]three[\\/](?!addons[\\/]tsl[\\/]display[\\/])/,
              priority: 10,
            },
            {
              name: 'vendor-rapier',
              test: /node_modules[\\/]@dimforge[\\/]rapier3d-compat/,
              priority: 10,
            },
          ],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
});
