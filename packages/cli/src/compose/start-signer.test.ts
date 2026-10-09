// oxlint-disable-next-line eslint/no-restricted-imports -- this test makes a build folder of its own and removes it
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chainRefSchema } from "@binference/chain";
import { createMemoryLogger } from "@binference/core/testing";
import { createP256KeyPair, formatAgentKey } from "@binference/signer";
import { build } from "tsdown";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startSignerProcess } from "./start-signer.js";

// The signer is built here, as a release builds it: Node runs it under its permission model, which
// lets it read only its own single file, never through a link.
const sourceEntry = fileURLToPath(
  new URL("../../../signer/src/process/signer-process.ts", import.meta.url),
);
const tsconfig = fileURLToPath(new URL("../../../signer/tsconfig.json", import.meta.url));
const distFolder = fileURLToPath(new URL("../../dist", import.meta.url));
const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const settings = {
  chains: [chainRefSchema.parse("eip155:56")],
  privyApi: "https://api.privy.io",
  networkFeeCaps: [{ chain: chainRefSchema.parse("eip155:56"), feePerGasBase: 1_000_000_000n }],
};
const folder = { path: "", entry: "" };

beforeAll(async () => {
  await mkdir(distFolder, { recursive: true });
  folder.path = await mkdtemp(join(distFolder, "signer-start-"));
  await build({
    config: false,
    entry: { "signer-process": sourceEntry },
    outDir: folder.path,
    format: "esm",
    platform: "node",
    dts: false,
    clean: true,
    logLevel: "silent",
    tsconfig,
    deps: { alwaysBundle: [/./], onlyBundle: false },
    inputOptions: { resolve: { conditionNames: ["@binference/source", "import", "default"] } },
  });
  folder.entry = join(folder.path, "signer-process.mjs");
}, 60_000);

afterAll(async () => {
  await rm(folder.path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}, 60_000);

function start(agentKey = formatAgentKey(createP256KeyPair())) {
  return startSignerProcess({
    entry: folder.entry,
    settings,
    agentKey,
    env: process.env,
    logger: createMemoryLogger({ subsystem: "engine" }),
    signal: new AbortController().signal,
  });
}

describe("the signer process the engine starts", () => {
  it("answers the agent key's public half, and ends once its input closes", async () => {
    const pair = createP256KeyPair();
    const signer = await start(formatAgentKey(pair));
    await expect(signer.client.publicKey(live())).resolves.toBe(pair.publicKey);
    await signer.stop(new AbortController().signal);
    await expect(signer.stopped).resolves.toBeUndefined();
    await expect(signer.client.publicKey(live())).rejects.toMatchObject({
      code: "signer.stopped",
    });
  });

  it("is ended at once when the stop's signal aborts", async () => {
    const signer = await start();
    await signer.stop(AbortSignal.abort());
    await expect(signer.stopped).resolves.toBeUndefined();
  });
});
