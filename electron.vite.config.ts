import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const resolvePath = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  main: {
    build: {
      lib: {
        // 抽取 worker 必须作为独立 Node/SSR 入口随安装包输出，不能依赖运行时携带 TypeScript。
        entry: {
          index: resolvePath('./electron/main/index.ts'),
          'extractor-worker': resolvePath(
            './electron/main/knowledge-ingestion/processing/extractor-worker.ts',
          ),
        },
      },
      rollupOptions: {
        output: {
          entryFileNames: '[name].js',
        },
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
