import type { ChainDefinition } from "@binference/chain";
import { registryEntryMakers } from "./entries/registry-entry-makers.js";

// A bridge destination, read only: binference holds no key here and signs nothing. Each mint was
// read on the cluster on this day: its token program, decimals, supply and authorities.
const { createTokens } = registryEntryMakers("2026-10-30");

const tokens = createTokens({
  "https://developers.circle.com/stablecoins/usdc-contract-addresses": [
    ["USDC", "USD Coin", 6, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
  ],
  "https://tether.to/en/supported-protocols": [
    ["USDT", "Tether USD", 6, "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"],
  ],
});

const clusters = "https://solana.com/docs/references/clusters";

/**
 * Solana mainnet-beta, where bridges from BSC deliver: its CAIP-2 id is the first 32 characters
 * of its genesis hash. Its tokens are SPL mints, its public RPCs and explorers.
 */
export const solana: ChainDefinition = {
  id: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  key: "solana",
  name: "Solana",
  family: "solana",
  nativeAsset: {
    assetNamespace: "slip44",
    assetReference: "501",
    symbol: "SOL",
    name: "Solana",
    decimals: 9,
  },
  blockTimeMs: 400,
  finality: { kind: "finalized_tag" },
  // Solana's own endpoint allows 100 requests in 10 s per address and is not meant for
  // production, so a second keyless one follows it.
  rpcs: [
    { name: "solana", url: "https://api.mainnet-beta.solana.com", source: clusters },
    {
      name: "publicnode",
      url: "https://solana-rpc.publicnode.com",
      source: "https://www.publicnode.com",
    },
  ],
  relays: [],
  explorers: [
    {
      name: "solana-explorer",
      url: "https://explorer.solana.com",
      txUrl: "https://explorer.solana.com/tx/{hash}",
      addressUrl: "https://explorer.solana.com/address/{address}",
      source: "https://explorer.solana.com",
    },
    {
      name: "solscan",
      url: "https://solscan.io",
      txUrl: "https://solscan.io/tx/{hash}",
      addressUrl: "https://solscan.io/account/{address}",
      source: "https://solscan.io",
    },
  ],
  tokens,
  contracts: [],
};
