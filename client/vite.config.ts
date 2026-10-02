import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// In development the client runs on Vite (5173) and proxies the API and
// sign-in routes to the server (8790), so both share one origin — the
// same as production, where the server serves the built client itself.
const server = process.env.WEBDDEPLOY_SERVER ?? 'http://127.0.0.1:8790';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': { target: server, changeOrigin: false },
      '/auth': { target: server, changeOrigin: false },
    },
  },
  build: { sourcemap: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
  },
});
