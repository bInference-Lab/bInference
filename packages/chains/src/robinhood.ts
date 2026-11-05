import type { ChainDefinition } from "@binference/chain";
import { registryEntryMakers } from "./entries/registry-entry-makers.js";

// A bridge destination, read only: binference holds no wallet here. Every address was read on
// chain on this day: its code, its decimals and symbol, its proxy slots and its owner.
const { createTokens, createContracts } = registryEntryMakers("2026-10-30");

// Robinhood Chain's dollar is Paxos's USDG: a bridge delivers USDC or USDT from BSC as USDG.
const tokens = createTokens({
  "https://docs.robinhood.com/chain/contracts": [
    ["USDG", "Global Dollar", 6, "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"],
    ["WETH", "WETH", 18, "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"],
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
      "spoke-pool": "0xD29C85F15DF544bA632C9E25829fd29d767d7978",
    },
  },
  "2026-11-01",
);

const connecting = "https://docs.robinhood.com/chain/connecting";

/**
 * Robinhood Chain, an Ethereum L2 on Arbitrum technology with gas in ETH, where bridges from BSC
 * deliver: its tokens, public RPCs and explorer.
 */
export const robinhood: ChainDefinition = {
  id: "eip155:4663",
  key: "robinhood",
  name: "Robinhood Chain",
  family: "evm",
  nativeAsset: {
    assetNamespace: "slip44",
    assetReference: "60",
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
  },
  blockTimeMs: 100,
  finality: { kind: "finalized_tag" },
  // Robinhood's own endpoint is rate limited and not meant for production, so a second keyless
  // one follows it.
  rpcs: [
    { name: "robinhood", url: "https://rpc.mainnet.chain.robinhood.com", source: connecting },
    {
      name: "publicnode",
      url: "https://robinhood-rpc.publicnode.com",
      source: "https://chainlist.org/chain/4663",
    },
  ],
  relays: [],
  explorers: [
    {
      name: "blockscout",
      url: "https://robinhoodchain.blockscout.com",
      txUrl: "https://robinhoodchain.blockscout.com/tx/{hash}",
      addressUrl: "https://robinhoodchain.blockscout.com/address/{address}",
      source: connecting,
    },
  ],
  tokens,
  contracts: [...multicall3, ...across],
};
