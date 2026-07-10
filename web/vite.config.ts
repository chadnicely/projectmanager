import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During dev, the React app talks to the existing Node backend.
// Point BASE_API at a local `node server.js` (default) or the live site.
const API = process.env.BASE_API || "http://localhost:4100";

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT) || 5173,
    proxy: {
      "/api": { target: API, changeOrigin: true },
      "/mcp": { target: API, changeOrigin: true },
    },
  },
  build: { outDir: "dist" },
});
