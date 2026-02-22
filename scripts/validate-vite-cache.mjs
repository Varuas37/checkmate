import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const viteDepsDir = path.join(projectRoot, "node_modules", ".vite", "deps");
const viteMetadataPath = path.join(viteDepsDir, "_metadata.json");

function clearViteDepsCache(reason) {
  rmSync(viteDepsDir, { recursive: true, force: true });
  console.warn(`[vite-cache] Cleared optimized deps cache (${reason}).`);
}

if (!existsSync(viteMetadataPath)) {
  process.exit(0);
}

let metadata;
try {
  const raw = readFileSync(viteMetadataPath, "utf8");
  metadata = JSON.parse(raw);
} catch {
  clearViteDepsCache("invalid metadata");
  process.exit(0);
}

const optimized = metadata?.optimized ?? {};
const missingOptimizedDeps = [];

for (const [depName, depMeta] of Object.entries(optimized)) {
  const src = depMeta?.src;
  if (typeof src !== "string" || src.length === 0) {
    continue;
  }

  const resolvedSrcPath = path.resolve(viteDepsDir, src);
  if (!existsSync(resolvedSrcPath)) {
    missingOptimizedDeps.push(depName);
  }
}

if (missingOptimizedDeps.length > 0) {
  clearViteDepsCache(`missing source modules: ${missingOptimizedDeps.join(", ")}`);
}
