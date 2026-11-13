import { defineConfig, type UserConfig } from "tsdown";
import { bundleRecord, bundleRecordFolder } from "../../config/build/bundle-record.mjs";

// The signer process runs with no file access at all, so Node can load only the one file it is
// started with: its entry is a single bundle with every dependency inside.
// tsdown empties dist and the builds' records once, for every config, before any of them builds:
// only the first asks, so no build removes another's files and no old chunk is left to ship. Each
// build records the outside modules in the files it writes, for the release's license check.
const config: UserConfig[] = defineConfig([
  {
    entry: ["src/index.ts"],
    format: "esm",
    dts: true,
    tsconfig: "tsconfig.json",
    clean: ["dist", bundleRecordFolder],
    plugins: [bundleRecord()],
  },
  {
    entry: { "signer-process": "src/process/signer-process.ts" },
    format: "esm",
    dts: false,
    tsconfig: "tsconfig.json",
    clean: false,
    plugins: [bundleRecord()],
    deps: { alwaysBundle: [/./], onlyBundle: false },
  },
]);

export default config;
