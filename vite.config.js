import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    // Increase the limit to 1000 KiB
    chunkSizeWarningLimit: 1000,
  },
});
