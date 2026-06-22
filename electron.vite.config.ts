import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const resolvePath = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: resolvePath('./electron/main/index.ts'),
      },
    },
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    build: {
      lib: {
        entry: resolvePath('./electron/preload/index.ts'),
      },
    },
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: 'src',
    resolve: {
      alias: {
        '@': resolvePath('./src'),
      },
    },
    build: {
      rollupOptions: {
        input: resolvePath('./src/index.html'),
      },
    },
    plugins: [react()],
  },
});
