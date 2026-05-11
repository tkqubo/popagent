import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["popagent.ts"],
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  clean: true,
  splitting: false,
  shims: false,
  banner: { js: "#!/usr/bin/env node" },
  // Bundle citty into the output to avoid runtime npm install on the consumer side
  noExternal: ["citty"],
});
