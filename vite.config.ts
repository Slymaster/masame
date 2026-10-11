import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const nullModule = new URL('./src/null-module.cjs', import.meta.url).pathname

// Tauri expects a fixed port and must not have its Rust output hidden by Vite.
export default defineConfig({
  plugins: [react()],
  // @sabaki/sgf only needs iconv-lite/jschardet to decode legacy-encoded Buffers; we parse strings, so keep ~800 kB out.
  resolve: { alias: { 'iconv-lite': nullModule, jschardet: nullModule } },
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
})
