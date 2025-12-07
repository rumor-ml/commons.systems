import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'src',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        viewer: resolve(__dirname, 'src/viewer.html'),
      },
    },
  },
  server: {
    port: 3002,
    open: true,
  },
});
