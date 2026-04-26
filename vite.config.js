import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
});
// vite.config.js

export default defineConfig({
  build: {
    // Increase the limit to 1000 KiB
    chunkSizeWarningLimit: 1000,
  },
});
