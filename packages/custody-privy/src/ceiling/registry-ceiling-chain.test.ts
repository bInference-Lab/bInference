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
import { launchCeilingOf, registryCeilingChain } from "./registry-ceiling-chain.js";

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

// A venue whose second call only a launch wallet makes, and whose third it never builds.
const launching = declaredVenue("swapper", {
  names: ["router", "permit2"],
  calls: [
    { contract: "router", abi: swapJson, walletInputs: [] },
    { contract: "router", abi: swapToJson, walletInputs: ["receiver"], isLaunchWalletOnly: true },
    {
      contract: "router",
      abi: abiFunctionJson({ ...testRouterAbi.swapTo, name: "swapFor" }),
      walletInputs: [],
      isLaunchWalletOnly: true,
      isUnbuilt: true,
    },
  ],
});

// The functions a ceiling of that venue lets a call reach, for a launch wallet or another.
function launchingCalls(wallet: { readonly isLaunch: boolean }) {
  const built = registryCeilingChain({
    definition,
    venues: [launching],
    perTxNativeCapBase: oneBnbWei,
    isLaunch: wallet.isLaunch,
  });
  return built.ok ? built.value.calls.map((call) => call.abi.name) : built.error;
}

// A venue whose router only a launch wallet approves.
const pulling = declaredVenue("swapper", {
  names: ["router", "permit2"],
  spenders: ["permit2"],
  launchWalletSpenders: ["router"],
});

// The spenders a ceiling of that venue allows, for a launch wallet or another.
function spendersFor(wallet: { readonly isLaunch: boolean }) {
  const built = registryCeilingChain({
    definition,
    venues: [pulling],
    perTxNativeCapBase: oneBnbWei,
    isLaunch: wallet.isLaunch,
  });
  return built.ok ? built.value.spenders : built.error;
}

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

  it("lists a call only a launch wallet makes in a launch wallet's ceiling alone, and one never built in none", () => {
    expect(launchingCalls({ isLaunch: false })).toStrictEqual([testRouterAbi.swap.name]);
    expect(launchingCalls({ isLaunch: true })).toStrictEqual([
      testRouterAbi.swap.name,
      testRouterAbi.swapTo.name,
    ]);
  });

  it("lists a spender only a launch wallet approves in a launch wallet's ceiling alone", () => {
    expect(spendersFor({ isLaunch: false })).toStrictEqual([testAddresses.permit2]);
    expect(spendersFor({ isLaunch: true })).toStrictEqual([
      testAddresses.permit2,
      testAddresses.router,
    ]);
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

  it("leaves out the calls and spenders on a launch's own contracts, which no list can hold", () => {
    const launchpad = declaredVenue("swapper", {
      names: ["router"],
      launchContracts: ["curve"],
      calls: [
        { contract: "curve", abi: swapToJson, walletInputs: ["receiver"] },
        { contract: "router", abi: swapJson, walletInputs: [] },
      ],
      spenders: ["curve"],
    });
    const chain = registryCeilingChain({
      definition,
      venues: [launchpad],
      perTxNativeCapBase: oneBnbWei,
    });
    expect(chain).toMatchObject({
      ok: true,
      value: {
        calls: [{ contract: testAddresses.router, abi: testRouterAbi.swap, walletInputs: [] }],
        spenders: [],
      },
    });
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

describe("launchCeilingOf", () => {
  const bsc = chainRefSchema.parse("eip155:56");
  const launchpad = declaredVenue("swapper", {
    names: ["router"],
    launchContracts: ["curve"],
    calls: [
      { contract: "curve", abi: swapToJson, walletInputs: ["receiver"] },
      { contract: "router", abi: swapJson, walletInputs: [] },
    ],
    spenders: ["curve"],
  });

  it("takes each call a venue declares on its launch contracts, and approves any spender", () => {
    expect(launchCeilingOf(bsc, [swapper, launchpad])).toStrictEqual({
      ok: true,
      value: {
        calls: [{ abi: testRouterAbi.swapTo, walletInputs: ["receiver"] }],
        approvesAnySpender: true,
      },
    });
  });

  it("adds nothing for venues with no launch contract, or on another chain", () => {
    expect(launchCeilingOf(bsc, [swapper])).toStrictEqual({ ok: true, value: undefined });
    const opbnb = chainRefSchema.parse("eip155:204");
    expect(launchCeilingOf(opbnb, [launchpad])).toStrictEqual({ ok: true, value: undefined });
  });

  it("refuses a launch call whose function is no JSON ABI entry", () => {
    const broken = declaredVenue("swapper", {
      names: ["router"],
      launchContracts: ["curve"],
      calls: [{ contract: "curve", abi: { name: "buy" }, walletInputs: ["recipient"] }],
    });
    expect(launchCeilingOf(bsc, [broken])).toStrictEqual({ ok: false, error: "bad_call" });
  });
});
