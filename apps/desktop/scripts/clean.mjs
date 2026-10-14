// Removes previous build outputs. Files in use (e.g. a portable exe that is running) are
// skipped with a warning instead of failing the build.
import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const release = join(dirname(fileURLToPath(import.meta.url)), "..", "release");
if (existsSync(release)) {
  for (const entry of readdirSync(release)) {
    try {
      rmSync(join(release, entry), { recursive: true, force: true });
    } catch (e) {
      console.warn(`skipped ${entry} (in use: ${e.code ?? e.message})`);
    }
  }
}
