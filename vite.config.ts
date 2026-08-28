import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'esnext',
    outDir: 'dist/renderer',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@i18n': path.resolve(__dirname, './src/i18n'),
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '^/(health|ready|public|auth|client|admin|workspace|orders|files|onboarding|tenant|platform|audit|webhooks|production|forms|drafts|schemas|ora|customers|notifications|contract)': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    exclude: ['electron']
  }
});
