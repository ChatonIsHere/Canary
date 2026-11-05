import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Served from https://chatonishere.github.io/Canary/, so asset paths are relative.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  // One page; React, Radix and uPlot together come to just over the default 500 kB warning.
  build: { chunkSizeWarningLimit: 700 },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
})
