// Bundle the server into a single ESM file for production, so the runtime image
// needs only `node` + this bundle — no tsx/esbuild (and their Go/native binaries)
// and no node_modules. @pp/shared (TS workspace) and ws are inlined; ws's optional
// native accelerators stay external and fall back to pure JS if absent at runtime.
import { build } from "esbuild";
import { stat } from "node:fs/promises";

const result = await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: "dist/index.js",
  // Native optional addons: not bundlable (.node), and ws try/catches their absence.
  external: ["bufferutil", "utf-8-validate"],
  // ESM output needs a require() shim for the external optional addons above.
  banner: {
    js: "import { createRequire as ___cr } from 'module'; const require = ___cr(import.meta.url);",
  },
  // "info" prints a size summary that marks any file over 1 MB with ⚠️ — a browser-bundle
  // heuristic; this is a server bundle (mostly @sentry/*), never downloaded by players.
  // Print only real warnings and errors, and fail on any warning: zero-warning builds.
  logLevel: "warning",
});
if (result.warnings.length > 0) {
  console.error(`server build: ${result.warnings.length} warning(s), failing`);
  process.exit(1);
}
const { size } = await stat("dist/index.js");
console.log(`server build: dist/index.js ${(size / 1024 / 1024).toFixed(1)} MB`);
