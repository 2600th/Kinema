import { defineConfig } from 'vitest/config';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    alias: {
      // Rapier 0.17+ package has "type":"module" but its CJS entry still
      // uses CommonJS exports. Force the ESM entry so vitest can load it.
      '@dimforge/rapier3d-compat': resolve(
        __dirname,
        'node_modules/@dimforge/rapier3d-compat/rapier.es.js',
      ),
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
