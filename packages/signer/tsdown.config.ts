import { defineConfig, type UserConfig } from "tsdown";

// The signer process runs with no file access at all, so Node can load only the one file it is
// started with: its entry is a single bundle with every dependency inside.
// tsdown empties dist once, for every config, before any of them builds: only the first asks,
// so no build removes another's files and no old chunk is left to ship.
const config: UserConfig[] = defineConfig([
  { entry: ["src/index.ts"], format: "esm", dts: true, tsconfig: "tsconfig.json", clean: true },
  {
    entry: { "signer-process": "src/process/signer-process.ts" },
    format: "esm",
    dts: false,
    tsconfig: "tsconfig.json",
    clean: false,
    deps: { alwaysBundle: [/./], onlyBundle: false },
  },
]);

export default config;
