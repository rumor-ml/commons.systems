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
    port: 3000,
    open: true,
  },
});
