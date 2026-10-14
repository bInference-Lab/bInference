// oxlint-disable-next-line eslint/no-restricted-imports -- a test's build folder of its own, removed after
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "tsdown";

/** The signer as a release builds it, in a folder of its own, and how to remove the folder. */
export interface SignerBundle {
  /** The built signer's one file, which `startSignerProcess` runs. */
  readonly entry: string;
  remove(): Promise<void>;
}

const sourceEntry = fileURLToPath(
  new URL("../../../signer/src/process/signer-process.ts", import.meta.url),
);
const tsconfig = fileURLToPath(new URL("../../../signer/tsconfig.json", import.meta.url));
const distFolder = fileURLToPath(new URL("../../dist", import.meta.url));

/**
 * Builds the signer as a release builds it, into a new folder under the CLI's `dist` named from
 * `prefix`: Node runs it under its permission model, which lets it read only its own single file,
 * never through a link. A test removes the folder once it is done.
 */
export async function buildSignerBundle(prefix: string): Promise<SignerBundle> {
  await mkdir(distFolder, { recursive: true });
  const folder = await mkdtemp(join(distFolder, prefix));
  await build({
    config: false,
    entry: { "signer-process": sourceEntry },
    outDir: folder,
    format: "esm",
    platform: "node",
    dts: false,
    clean: true,
    logLevel: "silent",
    tsconfig,
    deps: { alwaysBundle: [/./], onlyBundle: false },
    inputOptions: { resolve: { conditionNames: ["@binference/source", "import", "default"] } },
  });
  return {
    entry: join(folder, "signer-process.mjs"),
    remove: async () =>
      rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
  };
}
