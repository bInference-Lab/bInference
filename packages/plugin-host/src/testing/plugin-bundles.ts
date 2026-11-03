// oxlint-disable-next-line eslint/no-restricted-imports -- a test's build folder of its own, removed after
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "tsdown";

/** The plugin program and the probe plugin as a release builds them, in a folder of their own. */
export interface PluginBundles {
  /** The folder that holds both, and room for a test's plugin folders. */
  readonly folder: string;
  /** The plugin program, `plugin-process.mjs`, which every plugin runs in. */
  readonly program: string;
  /** The probe plugin's package folder, which holds `sandbox-probe.mjs` alone. */
  readonly probeFolder: string;
  remove(): Promise<void>;
}

const source = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));
const tsconfig = fileURLToPath(new URL("../../tsconfig.json", import.meta.url));
const distFolder = fileURLToPath(new URL("../../dist", import.meta.url));

async function bundle(entry: Readonly<Record<string, string>>, outDir: string): Promise<void> {
  await build({
    config: false,
    entry,
    outDir,
    format: "esm",
    platform: "node",
    dts: false,
    clean: true,
    logLevel: "silent",
    tsconfig,
    deps: { alwaysBundle: [/./], onlyBundle: false },
    outputOptions: { codeSplitting: false },
    inputOptions: { resolve: { conditionNames: ["@binference/source", "import", "default"] } },
  });
}

/**
 * Builds the plugin program and the probe plugin as a release builds them, into a new folder
 * under the package's `dist` named from `prefix`: a real folder, with no link on the way, since a
 * plugin's process may read only its own folders by their real paths. A test removes it once done.
 */
export async function buildPluginBundles(prefix: string): Promise<PluginBundles> {
  await mkdir(distFolder, { recursive: true });
  const folder = await mkdtemp(join(distFolder, prefix));
  const probeFolder = join(folder, "probe");
  await bundle({ "plugin-process": source("process/plugin-process.ts") }, join(folder, "program"));
  await bundle({ "sandbox-probe": source("probe/sandbox-probe.ts") }, probeFolder);
  return {
    folder,
    program: join(folder, "program", "plugin-process.mjs"),
    probeFolder,
    remove: async () =>
      rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
  };
}
