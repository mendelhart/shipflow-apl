import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

// Base44's vite plugin (HMR notifier, analytics tracker, visual edit agent)
// is gone; it only existed to talk to their editor. The '@' alias it used to
// provide is declared explicitly here so every existing import still resolves.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    // Sourcemaps ship the whole readable source tree to anyone who opens the
    // site — 7 MB of it, with no error-tracking service here to consume them.
    // 'hidden' still writes the .map files for local debugging but omits the
    // //# sourceMappingURL comment, so browsers don't fetch them. Set
    // VITE_SOURCEMAP=true if you ever need them served.
    sourcemap: process.env.VITE_SOURCEMAP === 'true' ? true : 'hidden',
    rollupOptions: {
      output: {
        // Keep the heavy PDF/chart libraries out of the entry chunk so first
        // paint isn't blocked on code most pages never touch.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          pdf: ['jspdf', 'jspdf-autotable', 'pdf-lib', 'html2canvas'],
          charts: ['recharts'],
        },
      },
    },
  },
})
