import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  server: { port: 5173, strictPort: false },
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
  optimizeDeps: { exclude: ["@hs/model", "@hs/dfm", "@hs/ops", "@hs/io", "@hs/docs", "@hs/providers", "@hs/ui-tokens"] },
});
