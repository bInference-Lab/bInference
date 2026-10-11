import { defineConfig, type UserConfig } from "tsdown";

// The runtime process may read only the one file it is started with, so its entry is a single
// bundle with every dependency inside.
const config: UserConfig[] = defineConfig([
  {
    entry: ["src/index.ts", "src/testing.ts"],
    format: "esm",
    dts: true,
    tsconfig: "tsconfig.json",
    clean: false,
  },
  {
    entry: { "runtime-process": "src/process/runtime-process.ts" },
    format: "esm",
    dts: false,
    tsconfig: "tsconfig.json",
    clean: false,
    deps: { alwaysBundle: [/./], onlyBundle: false },
  },
]);

export default config;
