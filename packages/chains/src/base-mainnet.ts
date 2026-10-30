import type { ChainDefinition } from "@binference/chain";
import { registryEntryMakers } from "./entries/registry-entry-makers.js";

// A bridge destination, read only: binference holds no wallet here. Every address was read on
// chain on this day: its code, its decimals and symbol, its proxy slots and its owner.
const { createTokens, createContracts } = registryEntryMakers("2026-10-30");

const tokens = createTokens({
  "https://developers.circle.com/stablecoins/usdc-contract-addresses": [
    ["USDC", "USD Coin", 6, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"],
  ],
  // The Tether USD bridged to Base that both bridges deliver; Tether lists no Base deployment.
  "https://app.across.to/api/available-routes": [
    ["USDT", "Tether USD", 6, "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2"],
  ],
  "https://docs.base.org/base-chain/network-information/base-contracts": [
    ["WETH", "Wrapped Ether", 18, "0x4200000000000000000000000000000000000006"],
  ],
});

// Read only: one call through it reads an account's coin and token balances.
const multicall3 = createContracts("multicall3", {
  "https://www.multicall3.com/deployments": {
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  },
});

const docs = "https://docs.base.org/base-chain/quickstart/connecting-to-base";

/** Base mainnet, where bridges from BSC deliver: its tokens, public RPCs and explorers. */
export const baseMainnet: ChainDefinition = {
  id: "eip155:8453",
  // "base" alone is a word the core spells, as an order's base token, so the key names the network.
  key: "base-mainnet",
  name: "Base",
  family: "evm",
  nativeAsset: {
    assetNamespace: "slip44",
    assetReference: "60",
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
  },
  blockTimeMs: 2_000,
  finality: { kind: "finalized_tag" },
  // Base's own endpoint is rate limited and meant for testing, so a second keyless one follows it.
  rpcs: [
    { name: "base", url: "https://mainnet.base.org", source: docs },
    {
      name: "publicnode",
      url: "https://base-rpc.publicnode.com",
      source: "https://chainlist.org/chain/8453",
    },
  ],
  relays: [],
  explorers: [
    {
      name: "basescan",
      url: "https://basescan.org",
      txUrl: "https://basescan.org/tx/{hash}",
      source: docs,
    },
  ],
  tokens,
  contracts: multicall3,
};
