import { err, ok } from "@binference/core";
import { describe, expect, it } from "vitest";
import { assetRefSchema } from "../caip/asset-ref.js";
import { createFakeChainDefinition } from "../fakes/fake-chain.js";
import { createFakeFamily } from "../fakes/fake-family.js";
import { createFakeSigningScheme } from "../fakes/fake-signing-scheme.js";
import { canonicalAsset } from "./canonical-asset.js";
import { createChainRegistry } from "./create-chain-registry.js";

const chains = createChainRegistry({
  chains: [createFakeChainDefinition()],
  families: [createFakeFamily()],
  signingSchemes: [createFakeSigningScheme()],
});
const token = assetRefSchema.parse("fake:1/token:0x0000000a");
const coin = assetRefSchema.parse("fake:1/slip44:1");

describe("canonical asset", () => {
  it("writes a token's address as its family does", () => {
    const shouted = assetRefSchema.parse("fake:1/token:0x0000000A");
    expect(canonicalAsset(chains, shouted)).toStrictEqual(ok(token));
  });

  it("keeps the chain's native coin as the registry writes it", () => {
    expect(canonicalAsset(chains, coin)).toStrictEqual(ok(coin));
  });

  it.each([
    ["a chain the registry lacks", "fake:9/token:0x0000000a"],
    ["an address the family cannot read", "fake:1/token:0x0a"],
    ["a namespace the family has no tokens in", "fake:1/nft:0x0000000a"],
    ["another coin of the chain", "fake:1/slip44:2"],
  ])("refuses %s", (_, text) => {
    expect(canonicalAsset(chains, assetRefSchema.parse(text))).toStrictEqual(err("unknown_asset"));
  });
});
