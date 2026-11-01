import { type ChainDefinition, chainRefSchema, type VenueDeclaration } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import type { CeilingRequest, ChainCaps } from "../ceiling/ceiling.js";
import { abiFunctionJson } from "../ceiling/policy-rule.js";
import { registryCeilingChain } from "../ceiling/registry-ceiling-chain.js";
import { stakingAbis } from "./bridge-fixtures.js";
import { stakingAddresses } from "./bridge-target-fixtures.js";
import { testCaps, testCeilingRequest } from "./custody-fixtures.js";

const bsc = chainRefSchema.parse("eip155:56");
const endpoint = { name: "rpc", url: "https://rpc.example.org", source: "https://example.org" };

// BNB Smart Chain as the tests' registry defines it: Relay's depository its one contract.
const testRelayChain: ChainDefinition = {
  id: bsc,
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
  explorers: [{ ...endpoint, txUrl: "https://scan.example.org/tx/{hash}" }],
  tokens: [],
  contracts: [
    {
      venue: "relay",
      name: "depository",
      address: stakingAddresses.depository,
      verification: {
        source: "https://example.org/docs",
        checkedOn: "2026-10-31",
        control: "read",
      },
    },
  ],
};

const depositCall = () => {
  const abi = stakingAbis["depositErc20"];
  if (abi === undefined) {
    throw new BinferenceError({ code: "internal.error", message: "No test ABI for depositErc20." });
  }
  return {
    contract: "depository",
    abi: abiFunctionJson(abi),
    walletInputs: ["depositor"],
    onlyWallet: "bridge" as const,
  };
};

// Relay as its plugin declares it on BNB Smart Chain (decision 0303): its depository's token
// deposit, pinning its depositor to the wallet, a bridge wallet's alone, and the depository as a
// spender only a bridge wallet approves.
const testRelayVenue: VenueDeclaration = {
  id: "relay",
  contracts: [
    {
      chain: bsc,
      names: ["depository"],
      calls: [depositCall()],
      onlyWalletSpenders: { bridge: ["depository"] },
    },
  ],
};

/**
 * The ceiling request of a bridge wallet as the registry plans it (decision 0307): Relay's
 * deposits and its depository from `registryCeilingChain` with the `bridge` role, beside the test
 * request's sends and the caps given; none of a main wallet's calls.
 */
export function testBridgeWalletCeilingRequest(caps: ChainCaps = testCaps): CeilingRequest {
  const planned = registryCeilingChain({
    definition: testRelayChain,
    venues: [testRelayVenue],
    perTxNativeCapBase: 10n ** 18n,
    role: "bridge",
  });
  if (!planned.ok) {
    throw new BinferenceError({ code: "internal.error", message: "Relay's test ceiling failed." });
  }
  return { ...testCeilingRequest(caps), chains: [{ ...planned.value, caps }] };
}
