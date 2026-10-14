import { chainRefSchema } from "@binference/chain";
import { createMemoryLogger } from "@binference/core/testing";
import { createP256KeyPair, formatAgentKey } from "@binference/signer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startSignerProcess } from "./start-signer.js";
import { buildSignerBundle, type SignerBundle } from "./test-signer-bundle.js";

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const settings = {
  chains: [chainRefSchema.parse("eip155:56")],
  privyApi: "https://api.privy.io",
  networkFeeCaps: [{ chain: chainRefSchema.parse("eip155:56"), feePerGasBase: 1_000_000_000n }],
};
const built: { bundle?: SignerBundle } = {};

beforeAll(async () => {
  built.bundle = await buildSignerBundle("signer-start-");
}, 60_000);

afterAll(async () => {
  await built.bundle?.remove();
}, 60_000);

function start(agentKey = formatAgentKey(createP256KeyPair())) {
  return startSignerProcess({
    entry: built.bundle?.entry ?? "",
    settings,
    agentKey,
    env: process.env,
    logger: createMemoryLogger({ subsystem: "engine" }),
    onRefusal: () => undefined,
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
