import { defineConfig } from 'vite';

// The server owns /events, /api and /healthz; Vite serves the UI and proxies them
// through in development. In production apps/server serves this build from dist/.
const target = process.env.LAPLINE_SERVER ?? 'http://localhost:3000';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/events': { target, changeOrigin: true },
      '/api': { target, changeOrigin: true },
      '/healthz': { target, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
