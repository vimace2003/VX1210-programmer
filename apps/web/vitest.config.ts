import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { buildDefines } from "./build-info";

export default defineConfig({
  plugins: [react()],
  define: buildDefines(),
  test: { environment: "jsdom", testTimeout: 20000 },
});
