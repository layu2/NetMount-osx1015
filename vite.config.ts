import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// macOS Catalina ships WKWebView based on Safari 13.1.
// Vite's default production target is newer than Catalina's WebKit and can
// emit syntax that fails before React mounts, leaving a completely white view.
const catalinaWebViewTarget = 'safari13.1'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  esbuild: {
    target: catalinaWebViewTarget,
  },
  optimizeDeps: {
    esbuildOptions: {
      target: catalinaWebViewTarget,
    },
  },
  build: {
    target: catalinaWebViewTarget,
    cssTarget: catalinaWebViewTarget,
  },
})
