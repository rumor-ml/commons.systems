import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'src',
  envDir: resolve(__dirname), // Load .env from project root, not src/
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        cards: resolve(__dirname, 'src/cards.html'),
      },
    },
  },
  server: {
    host: '127.0.0.1', // Use IPv4 to avoid IPv6 binding issues with sandbox
    port: 3000,
    open: true,
  },
});
