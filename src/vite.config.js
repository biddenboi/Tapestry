import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@app': fileURLToPath(new URL('./app', import.meta.url)),
      '@data': fileURLToPath(new URL('./data', import.meta.url)),
      '@domain': fileURLToPath(new URL('./domain', import.meta.url)),
      '@features': fileURLToPath(new URL('./features', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
