import { fileURLToPath, URL } from 'node:url'
import { rmSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const alias = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'exclude-legacy-public-sqlite-wasm',
      closeBundle() {
        // The worker imports the package-owned hashed Wasm asset. Keep the
        // old public fallback out of production so iOS downloads one copy.
        rmSync(alias('./dist/sqlite3.wasm'), { force: true })
      },
    },
  ],
  base: './', // Important for Electron
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@app': alias('./src/app'),
      '@data': alias('./src/data'),
      '@features': alias('./src/features'),
      '@shared': alias('./src/shared'),
      '@domain': alias('./src/domain'),
    },
  },
  build: {
    outDir: 'dist'
  }
})
