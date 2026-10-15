import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

const nullModule = new URL('./src/null-module.cjs', import.meta.url).pathname
// Set by `tauri ios|android dev` when a phone loads the dev server over the network; unset on desktop.
// @ts-expect-error process is a Node global; the config runs in Node, without @types/node
const host = process.env.TAURI_DEV_HOST

// Tauri expects a fixed port and must not have its Rust output hidden by Vite.
export default defineConfig({
  plugins: [react()],
  // @sabaki/sgf only needs iconv-lite/jschardet to decode legacy-encoded Buffers; we parse strings, so keep ~800 kB out.
  resolve: { alias: { 'iconv-lite': nullModule, jschardet: nullModule } },
  clearScreen: false,
  // Nested worktrees under .claude/ carry their own copies of the tests.
  // Slow CI runners (Intel macOS) need more than vitest's default 5 s for the heavier tests.
  test: { exclude: [...configDefaults.exclude, '.claude/**'], testTimeout: 30_000 },
  server: {
    port: 1420, strictPort: true, host: host || false, hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
})
