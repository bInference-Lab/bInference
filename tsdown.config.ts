import { defineConfig, type UserConfig } from "tsdown";
import { bundleRecord, bundleRecordFolder } from "./config/build/bundle-record.mjs";

// A package's `tsdown` run reads this file when the package has no tsdown.config.ts of its own:
// tsdown looks for one from the package's folder up. Each build records the outside modules in
// every file it writes, for the licenses the release ships beside them.
const config: UserConfig = defineConfig({
  plugins: [bundleRecord()],
  clean: ["dist", bundleRecordFolder],
});

export default config;
