import { defineConfig } from 'vitest/config';
import wasm from 'vite-plugin-wasm';
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
  plugins: [wasm()],
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
    },
  },
  build: {
    target: 'esnext',
    // Vite 8: rollupOptions is auto-converted to rolldownOptions via compat layer.
    // manualChunks function form is deprecated but still works. Migrate to
    // advancedChunks when Rolldown stabilizes the API.
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Group three.js core and three/webgpu into a single vendor chunk.
          // TSL display nodes (three/addons/tsl/display/*) remain as separate
          // async chunks since they are dynamically imported by the post-processing pipeline.
          if (id.includes('node_modules/three/')) {
            if (id.includes('/addons/tsl/display/')) return undefined;
            return 'vendor-three';
          }
          if (id.includes('node_modules/@dimforge/rapier3d-compat')) {
            return 'vendor-rapier';
          }
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
});
