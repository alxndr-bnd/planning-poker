// Bundle the server into a single ESM file for production, so the runtime image
// needs only `node` + this bundle — no tsx/esbuild (and their Go/native binaries)
// and no node_modules. @pp/shared (TS workspace) and ws are inlined; ws's optional
// native accelerators stay external and fall back to pure JS if absent at runtime.
import { build } from "esbuild";

await build({
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
  logLevel: "info",
});
