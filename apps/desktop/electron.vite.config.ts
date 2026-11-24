import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// Workspace packages point their `main` at .ts source; they must be bundled
// into the main + preload outputs, not externalized, or Node can't load them
// at runtime (ERR_UNKNOWN_FILE_EXTENSION ".ts").
const WORKSPACE_DEPS = ['@bullebrowser/brand-tokens', '@bullebrowser/agent-core'];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_DEPS })],
    build: {
      outDir: 'out/main',
      // Ship minified code without source maps, so the installed app does not
      // carry readable source.
      minify: 'esbuild',
      sourcemap: false,
      lib: { entry: resolve(__dirname, 'src/main/index.ts') },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
  preload: {
    // Preload runs in a sandboxed Electron context that does not support ESM —
    // emit CommonJS, otherwise `contextBridge.exposeInMainWorld` never runs and
    // window.bullebrowser is undefined in the renderer.
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_DEPS })],
    build: {
      outDir: 'out/preload',
      minify: 'esbuild',
      sourcemap: false,
      lib: {
        // index: the app window's bridge. tab: each web page's saved-password helper.
        entry: { index: resolve(__dirname, 'src/preload/index.ts'), tab: resolve(__dirname, 'src/preload/tab.ts') },
        formats: ['cjs'],
        fileName: (_format, name) => `${name}.cjs`,
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
      minify: 'esbuild',
      sourcemap: false,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer'),
      },
    },
  },
});
