import {
  type ChainDefinition,
  chainRefSchema,
  type ContractDefinition,
  type VenueContracts,
  type VenueDeclaration,
} from "@binference/chain";
import { describe, expect, it } from "vitest";
import { oneBnbWei, testAddresses, testChain, testRouterAbi } from "../testing/custody-fixtures.js";
import { abiFunctionJson } from "./policy-rule.js";
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

const swapJson = abiFunctionJson(testRouterAbi.swap);
const swapToJson = abiFunctionJson(testRouterAbi.swapTo);

function declaredVenue(
  id: string,
  contracts: Omit<VenueContracts, "chain">,
  chain = "eip155:56",
): VenueDeclaration {
  return { id, contracts: [{ chain: chainRefSchema.parse(chain), ...contracts }] };
}

const swapper = declaredVenue("swapper", {
  names: ["router", "permit2"],
  calls: [
    { contract: "router", abi: swapJson, walletInputs: [] },
    { contract: "router", abi: swapToJson, walletInputs: ["receiver"] },
  ],
  spenders: ["router"],
});

describe("registryCeilingChain", () => {
  it("lists the calls and spenders each enabled venue declares on the chain, and only those", () => {
    const chain = registryCeilingChain({
      definition,
      venues: [swapper],
      perTxNativeCapBase: oneBnbWei,
    });
    expect(chain).toStrictEqual({
      ok: true,
      value: {
        chain: testChain,
        calls: [
          { contract: testAddresses.router, abi: testRouterAbi.swap, walletInputs: [] },
          { contract: testAddresses.router, abi: testRouterAbi.swapTo, walletInputs: ["receiver"] },
        ],
        spenders: [testAddresses.router],
        perTxNativeCapBase: oneBnbWei,
      },
    });
  });

  it("lets a venue that declares no call or spender add nothing, nor one on another chain", () => {
    const chain = registryCeilingChain({
      definition,
      venues: [
        declaredVenue("swapper", { names: ["router", "permit2"] }),
        declaredVenue("lender", { names: ["pool"], spenders: ["pool"] }, "eip155:1"),
      ],
      perTxNativeCapBase: 0n,
    });
    expect(chain).toMatchObject({ ok: true, value: { calls: [], spenders: [] } });
  });

  it("lists a spender two venues share once", () => {
    const chain = registryCeilingChain({
      definition: {
        ...definition,
        contracts: [...definition.contracts, contract("other", "router", testAddresses.router)],
      },
      venues: [swapper, declaredVenue("other", { names: ["router"], spenders: ["router"] })],
      perTxNativeCapBase: 0n,
    });
    expect(chain).toMatchObject({ ok: true, value: { spenders: [testAddresses.router] } });
  });

  it("refuses a contract name the chain definition does not hold for the venue", () => {
    const chain = registryCeilingChain({
      definition,
      venues: [declaredVenue("swapper", { names: ["router", "pool"] })],
      perTxNativeCapBase: oneBnbWei,
    });
    expect(chain).toStrictEqual({ ok: false, error: "unknown_contract" });
  });

  it("refuses a call whose function is no JSON ABI entry", () => {
    const chain = registryCeilingChain({
      definition,
      venues: [
        declaredVenue("swapper", {
          names: ["router"],
          calls: [{ contract: "router", abi: { name: "swap" }, walletInputs: [] }],
        }),
      ],
      perTxNativeCapBase: oneBnbWei,
    });
    expect(chain).toStrictEqual({ ok: false, error: "bad_call" });
  });
});
