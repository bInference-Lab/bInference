import type { ChainDefinition } from "@binference/chain";
import { registryEntryMakers } from "./entries/registry-entry-makers.js";

// A bridge destination, read only: binference holds no wallet here. Every address was read on
// chain on this day: its code, its decimals and symbol, its proxy slots and its owner.
const { createTokens, createContracts } = registryEntryMakers("2026-10-30");

const tokens = createTokens({
  "https://developers.circle.com/stablecoins/usdc-contract-addresses": [
    ["USDC", "USD Coin", 6, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"],
  ],
  "https://tether.to/en/supported-protocols": [
    ["USDT", "Tether USD", 6, "0xdAC17F958D2ee523a2206206994597C13D831ec7"],
  ],
  "https://app.across.to/api/available-routes": [
    ["WETH", "Wrapped Ether", 18, "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"],
  ],
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
      "spoke-pool": "0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5",
    },
  },
  "2026-11-01",
);

const rpcList = "https://chainlist.org/chain/1";

/** Ethereum mainnet, where bridges from BSC deliver: its tokens, public RPCs and explorers. */
export const ethereum: ChainDefinition = {
  id: "eip155:1",
  key: "ethereum",
  name: "Ethereum",
  family: "evm",
  nativeAsset: {
    assetNamespace: "slip44",
    assetReference: "60",
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
  },
  blockTimeMs: 12_000,
  finality: { kind: "finalized_tag" },
  // Keyless public endpoints that keep no request logs, as Chainlist marks them.
  rpcs: [
    { name: "publicnode", url: "https://ethereum-rpc.publicnode.com", source: rpcList },
    { name: "drpc", url: "https://eth.drpc.org", source: rpcList },
  ],
  relays: [],
  explorers: [
    {
      name: "etherscan",
      url: "https://etherscan.io",
      txUrl: "https://etherscan.io/tx/{hash}",
      source: "https://ethereum.org/developers/docs/data-and-analytics/block-explorers",
    },
  ],
  tokens,
  contracts: [...multicall3, ...across],
};
