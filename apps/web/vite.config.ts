import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { buildDefines } from "./build-info";

// Web Serial needs a secure context: http://localhost (dev/preview) or HTTPS hosting.
export default defineConfig({
  plugins: [react()],
  base: "./",
  define: buildDefines(),
  server: { port: 5173, strictPort: false },
});
