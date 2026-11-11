import { defineConfig, type UserConfig } from "tsdown";

// Each program runs from one file with every dependency inside: a plugin's process may read only
// its own folders and the file it is started with, and the image's three programs stand alone. The
// probe plugin sits in a folder of its own, which is all its process may read.
function program(name: string, source: string, outDir = "dist"): UserConfig {
  return {
    entry: { [name]: source },
    outDir,
    format: "esm",
    dts: false,
    tsconfig: "tsconfig.json",
    clean: true,
    deps: { alwaysBundle: [/./], onlyBundle: false },
    outputOptions: { codeSplitting: false },
  };
}

// tsdown empties dist once, for every config, before any of them builds: only the first asks,
// so no build removes another's files and no old chunk is left to ship.
const config: UserConfig[] = defineConfig([
  // The testing entry builds with the bundler, so tests read it from its source alone.
  {
    entry: ["src/index.ts"],
    format: "esm",
    dts: true,
    tsconfig: "tsconfig.json",
    clean: false,
  },
  program("plugin-process", "src/process/plugin-process.ts"),
  program("sandbox-probe", "src/probe/sandbox-probe.ts", "dist/probe"),
  program("plugin-launcher", "src/launcher/plugin-launcher.ts"),
  program("shell-launcher", "src/launcher/shell-launcher.ts"),
  { ...program("image-entry", "src/launcher/image-entry.ts"), banner: "#!/usr/bin/env node" },
]);

export default config;
