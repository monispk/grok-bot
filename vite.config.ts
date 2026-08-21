import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Everything is inlined into one index.html. On a ~99ms RTT link from Pakistan,
// each additional sequential asset request costs another full round trip, so the
// whole app ships in the first response.
export default defineConfig({
  plugins: [preact(), viteSingleFile()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    reportCompressedSize: true,
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3099' },
  },
})
