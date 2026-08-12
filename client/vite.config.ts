import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: "./", // Ensures assets are loaded via relative paths for Electron
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"), // Useful shortcut for clean imports
    },
  },
  build: {
    outDir: "dist", // Coordinates with your Electron main.js loading path
    emptyOutDir: true,
  },
});
