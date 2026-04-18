import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Shared reducer + constants + logic used by BOTH the client renderer
      // and the server. Keeping the alias means both sides import from the
      // same source file - the reducer can never silently drift.
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  server: {
    port: 5173,
    // Allow Vite to serve files from ../shared (outside the frontend root).
    fs: { allow: [path.resolve(__dirname, '..')] },
  },
});
