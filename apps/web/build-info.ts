// Compile-time constants shared by vite.config.ts and vitest.config.ts.
// The product version is the one of the Windows program (apps/desktop/package.json).
import { readFileSync } from "node:fs";

const desktopPkg = JSON.parse(readFileSync(new URL("../desktop/package.json", import.meta.url), "utf8")) as { version: string };

export function buildDefines(): Record<string, string> {
  return {
    __APP_VERSION__: JSON.stringify(desktopPkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  };
}
