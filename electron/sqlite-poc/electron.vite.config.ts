import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { fileURLToPath } from 'node:url';

const resolvePath = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  main: {
    build: {
      outDir: resolvePath('../../out/sqlite-poc'),
      lib: {
        entry: resolvePath('./index.ts'),
      },
      rollupOptions: {
        output: {
          entryFileNames: 'index.js',
        },
      },
    },
    // better-sqlite3 是原生模块，必须由 Electron 直接加载，不能打进 JavaScript 包。
    plugins: [externalizeDepsPlugin()],
  },
});
