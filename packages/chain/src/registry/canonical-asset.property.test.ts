import { ok } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AssetRef, assetRefSchema } from "../caip/asset-ref.js";
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
const address = fc.stringMatching(/^[0-9a-fA-F]{8}$/);

// The canonical form of the fake token at `digits`, which every fake address has.
function canonicalOf(digits: string): AssetRef {
  const canonical = canonicalAsset(chains, assetRefSchema.parse(`fake:1/token:0x${digits}`));
  if (!canonical.ok) {
    throw new Error(`Expected a canonical form of ${digits}.`);
  }
  return canonical.value;
}

describe("canonical asset", () => {
  it("gives every spelling of one token one form, and keeps that form", () => {
    fc.assert(
      fc.property(address, address, (first, second) => {
        const canonical = canonicalOf(first);
        expect(canonicalAsset(chains, canonical)).toStrictEqual(ok(canonical));
        expect(canonicalOf(second) === canonical).toBe(
          first.toLowerCase() === second.toLowerCase(),
        );
      }),
    );
  });
});
