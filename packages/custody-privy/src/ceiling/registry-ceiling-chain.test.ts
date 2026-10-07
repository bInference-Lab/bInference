import {
  type ChainDefinition,
  chainRefSchema,
  type ContractDefinition,
  type VenueDeclaration,
} from "@binference/chain";
import { describe, expect, it } from "vitest";
import { oneBnbWei, testAddresses, testChain } from "../testing/custody-fixtures.js";
import { registryCeilingChain } from "./registry-ceiling-chain.js";

const verification = {
  source: "https://example.org/docs",
  checkedOn: "2026-10-06",
  control: "read",
} as const;
const contract = (venue: string, name: string, address: string): ContractDefinition => ({
  venue,
  name,
  address,
  verification,
});

const endpoint = { name: "rpc", url: "https://rpc.example.org", source: "https://example.org" };
const definition: ChainDefinition = {
  id: "eip155:56",
  key: "bsc",
  name: "BNB Smart Chain",
  family: "evm",
  nativeAsset: {
    assetNamespace: "slip44",
    assetReference: "714",
    symbol: "BNB",
    name: "BNB",
    decimals: 18,
  },
  blockTimeMs: 750,
  finality: { kind: "finalized_tag" },
  rpcs: [endpoint],
  relays: [],
  explorers: [endpoint],
  tokens: [],
  contracts: [
    contract("swapper", "router", testAddresses.router),
    contract("swapper", "permit2", testAddresses.permit2),
    contract("lender", "pool", testAddresses.unlisted),
  ],
};

function declaredVenue(
  id: string,
  names: readonly string[],
  chain = "eip155:56",
): VenueDeclaration {
  return { id, contracts: [{ chain: chainRefSchema.parse(chain), names }] };
}

describe("registryCeilingChain", () => {
  it("lists the contracts each enabled venue declares on the chain, and only those", () => {
    const chain = registryCeilingChain({
      definition,
      venues: [declaredVenue("swapper", ["router", "permit2"])],
      perTxNativeCapBase: oneBnbWei,
    });
    expect(chain).toStrictEqual({
      ok: true,
      value: {
        chain: testChain,
        contracts: [testAddresses.router, testAddresses.permit2],
        spenders: [testAddresses.router, testAddresses.permit2],
        perTxNativeCapBase: oneBnbWei,
      },
    });
  });

  it("lists a contract two venues share once, and nothing for a venue on another chain", () => {
    const chain = registryCeilingChain({
      definition: {
        ...definition,
        contracts: [...definition.contracts, contract("other", "router", testAddresses.router)],
      },
      venues: [
        declaredVenue("swapper", ["router"]),
        declaredVenue("other", ["router"]),
        declaredVenue("lender", ["pool"], "eip155:1"),
      ],
      perTxNativeCapBase: 0n,
    });
    expect(chain).toMatchObject({ ok: true, value: { contracts: [testAddresses.router] } });
  });

  it("refuses a contract name the chain definition does not hold for the venue", () => {
    const chain = registryCeilingChain({
      definition,
      venues: [declaredVenue("swapper", ["router", "pool"])],
      perTxNativeCapBase: oneBnbWei,
    });
    expect(chain).toStrictEqual({ ok: false, error: "unknown_contract" });
  });
});
