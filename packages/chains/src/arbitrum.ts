import type { ChainDefinition } from "@binference/chain";
import { registryEntryMakers } from "./entries/registry-entry-makers.js";

// A bridge destination, read only: binference holds no wallet here. Every address was read on
// chain on this day: its code, its decimals and symbol, its proxy slots and its owner.
const { createTokens, createContracts } = registryEntryMakers("2026-10-30");

const chainInfo = "https://docs.arbitrum.io/for-devs/dev-tools-and-resources/chain-info";

// The Tether on Arbitrum One is USDT0 (its symbol on chain is "USD₮0"), which both bridges
// deliver for USDT.
const tokens = createTokens({
  "https://developers.circle.com/stablecoins/usdc-contract-addresses": [
    ["USDC", "USD Coin", 6, "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"],
  ],
  "https://docs.usdt0.to/technical-documentation/deployments": [
    ["USDT0", "USD₮0", 6, "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9"],
  ],
  [chainInfo]: [["WETH", "Wrapped Ether", 18, "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"]],
});

// Read only: one call through it reads an account's coin and token balances.
const multicall3 = createContracts("multicall3", {
  "https://www.multicall3.com/deployments": {
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  },
});

// Read only: the SpokePool whose fill event says a bridge's deposit from BSC arrived (decision 0320).
const across = createContracts(
  "across",
  {
    "https://github.com/across-protocol/contracts/blob/master/broadcast/deployed-addresses.json": {
      "spoke-pool": "0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A",
    },
  },
  "2026-11-01",
);

/** Arbitrum One, where bridges from BSC deliver: its tokens, public RPCs and explorers. */
export const arbitrum: ChainDefinition = {
  id: "eip155:42161",
  key: "arbitrum",
  name: "Arbitrum One",
  family: "evm",
  nativeAsset: {
    assetNamespace: "slip44",
    assetReference: "60",
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
  },
  blockTimeMs: 250,
  finality: { kind: "finalized_tag" },
  rpcs: [
    { name: "arbitrum", url: "https://arb1.arbitrum.io/rpc", source: chainInfo },
    {
      name: "publicnode",
      url: "https://arbitrum-one-rpc.publicnode.com",
      source: "https://chainlist.org/chain/42161",
    },
  ],
  relays: [],
  explorers: [
    {
      name: "arbiscan",
      url: "https://arbiscan.io",
      txUrl: "https://arbiscan.io/tx/{hash}",
      addressUrl: "https://arbiscan.io/address/{address}",
      source: chainInfo,
    },
  ],
  tokens,
  contracts: [...multicall3, ...across],
};
