import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

await build({
  entryPoints: {
    background: "src/background/index.ts",
    content: "src/content/index.ts",
    popup: "src/popup/index.ts",
    options: "src/options/index.ts"
  },
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome120",
  sourcemap: true,
  logLevel: "info"
});

await cp("public", "dist", { recursive: true });
