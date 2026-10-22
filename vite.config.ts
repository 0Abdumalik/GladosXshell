import { defineConfig } from 'vite'

// Tauri needs a fixed port and must see Rust errors, so no screen clearing.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: false,
    watch: { ignored: ['**/src-tauri/**', '**/crates/**', '**/target/**'] },
  },
  build: {
    target: 'es2022',
    // Paths are relative to the project root, where every build runs.
    rolldownOptions: {
      input: {
        main: 'index.html',
        'status-panel': 'status-panel.html',
        'plugin-guide': 'plugin-guide.html',
      },
    },
  },
})
