import { describe, expect, it } from "vitest";
import { checkDefinition } from "./checks/definition-checks.js";
import { solana } from "./solana.js";

// Base58 text of a 32-byte address; the codec in @binference/chain-solana reads each mint back.
const base58Address = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

checkDefinition(solana, (address) => base58Address.test(address));

describe("solana as a bridge destination", () => {
  it("is mainnet-beta, named by the first 32 characters of its genesis hash", () => {
    expect(solana.id).toBe("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
    expect(solana.family).toBe("solana");
    expect(solana.nativeAsset).toMatchObject({ assetReference: "501", decimals: 9 });
  });

  it("sends nothing and calls no contract: it has no relay and no venue", () => {
    expect([solana.relays, solana.contracts]).toStrictEqual([[], []]);
  });
});
