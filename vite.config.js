import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  publicDir: "public",
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    rollupOptions: {
      input: {
        background: "background.html",
        sidebar:    "sidebar.html"
      }
    }
  }
});