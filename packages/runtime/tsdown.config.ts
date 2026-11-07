import { defineConfig, type UserConfig } from "tsdown";

// The runtime process may read only the files it is granted, so its entry is a single bundle with
// every dependency inside, and so is the agent database's store worker beside it.
// tsdown empties dist once, for every config, before any of them builds: only the first asks,
// so no build removes another's files and no old chunk is left to ship.
const config: UserConfig[] = defineConfig([
  {
    entry: ["src/index.ts", "src/testing.ts"],
    format: "esm",
    dts: true,
    tsconfig: "tsconfig.json",
    clean: true,
  },
  {
    entry: { "runtime-process": "src/process/runtime-process.ts" },
    format: "esm",
    dts: false,
    tsconfig: "tsconfig.json",
    clean: false,
    deps: { alwaysBundle: [/./], onlyBundle: false },
    // A dynamic import, such as the model SDKs' lazy loads, would become a chunk of its own that
    // the permission model refuses to read.
    outputOptions: { codeSplitting: false },
  },
  // A build of its own, so it shares no chunk with the entry: each file stands alone.
  {
    entry: { "agent.worker": "src/process/agent.worker.ts" },
    format: "esm",
    dts: false,
    tsconfig: "tsconfig.json",
    clean: false,
    deps: { alwaysBundle: [/./], onlyBundle: false },
  },
]);

export default config;
