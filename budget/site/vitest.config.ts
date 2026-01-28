import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  envDir: './__nonexistent__', // Don't load .env files during tests - override vite.config.js
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    pool: 'threads',
    poolOptions: {
      threads: {
        maxThreads: 2,
        minThreads: 1,
      },
    },
  },
});
