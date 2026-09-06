/// <reference types="vitest" />
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "path"

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, "../public"),
    emptyOutDir: false
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts"
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000"
    }
  }
})
