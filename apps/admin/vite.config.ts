import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The Admin SPA calls the platform API under the same origin at `/api`, which
// is proxied (dev: here; prod: by the Express server in src/server.ts) to the
// real API. This keeps the admin token first-party and avoids CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: Number(process.env.ADMIN_PORT) || 5173,
    proxy: {
      "/api": {
        target: process.env.INTEL_API_URL || "http://localhost:4000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          charts: ["recharts"],
          query: ["@tanstack/react-query"],
        },
      },
    },
  },
});

