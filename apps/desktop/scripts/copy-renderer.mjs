// Copies the production build of apps/web into ./renderer (packaged inside the app).
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "web", "dist");
const dst = join(here, "..", "renderer");
if (!existsSync(join(src, "index.html"))) {
  console.error(`web build not found in ${src}; run "npm run build -w @ce42/web" first`);
  process.exit(1);
}
rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true });
console.log(`renderer copied from ${src}`);
