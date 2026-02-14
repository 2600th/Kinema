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
    },
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-three': ['three'],
          'vendor-rapier': ['@dimforge/rapier3d-compat'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
});
