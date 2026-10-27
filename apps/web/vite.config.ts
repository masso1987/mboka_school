import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Consume the shared package from source so the web build does not depend on its CommonJS output.
    alias: { '@mboka/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) },
  },
  server: {
    port: 5173,
    // Same-origin in development: the session cookie stays first-party and SameSite=Lax applies.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
