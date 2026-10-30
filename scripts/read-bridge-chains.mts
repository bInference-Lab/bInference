import {
  arbitrum,
  baseMainnet,
  bsc,
  bscBridgeRoutes,
  ethereum,
  robinhood,
  solana,
} from "@binference/chains";
import { liveParts } from "./bridge-chains/live-parts.mjs";
import { oneByOne } from "./bridge-chains/one-by-one.mjs";
import { readEvmChain } from "./bridge-chains/read-evm-chain.mjs";
import {
  quoteRelay,
  readAcrossRoutes,
  readRelayRoutes,
  type RouteChain,
} from "./bridge-chains/read-routes.mjs";
import { readSolanaChain } from "./bridge-chains/read-solana-chain.mjs";
import { acrossFill, relayFill } from "./bridge-chains/reported-fills.mjs";

// Reads the chains bridges from BSC deliver to back on each chain, live, and prints a report:
// every RPC's chain id, every token's code, checksum, decimals, proxy slots and owner, every
// Solana mint, one delivery a bridge reported on each chain read through its DeliveryReader, and
// the routes each bridge's own API lists from BSC against the registry. It sends no personal data
// and never runs in pnpm check:
//
//   pnpm chains:read
//
// Relay's chain id for Solana is its own; Across's too.
const parts = liveParts();
const evmChains = [
  { definition: ethereum, chainId: 1 },
  { definition: baseMainnet, chainId: 8453 },
  { definition: arbitrum, chainId: 42_161 },
  { definition: robinhood, chainId: 4663 },
];
const relaySolanaId = 792_703_809;
const acrossSolanaId = 34_268_394_551_451;

const report: string[] = [`# Bridge destination chains, read ${new Date().toISOString()}`, ""];
// Relay's requests endpoint is read only where Relay alone delivers a registry token, so its rate
// limit is not spent; Across's fills cover the rest.
const evmReports = await oneByOne(evmChains, async ({ definition, chainId }) => {
  const relayFills = definition === robinhood ? await relayFill(definition, chainId) : [];
  const fills = [...(await acrossFill(definition, chainId)), ...relayFills];
  return [...(await readEvmChain(definition, fills, parts)), ""];
});
report.push(...evmReports.flat());
report.push(...(await readSolanaChain(solana, await relayFill(solana, relaySolanaId), parts)), "");

const chains: RouteChain[] = [
  ...evmChains.map(({ definition, chainId }) => ({
    definition,
    acrossId: chainId,
    relayId: chainId,
  })),
  { definition: solana, acrossId: acrossSolanaId, relayId: relaySolanaId },
];
const routes = { chains, registry: bscBridgeRoutes };
report.push(...(await readAcrossRoutes(routes)), "", ...(await readRelayRoutes(routes)), "");

const usdg = robinhood.tokens.find(({ symbol }) => symbol === "USDG")?.address ?? "";
const quotes = await oneByOne(["USDC", "USDT"], async (symbol) => {
  const from = bsc.tokens.find((token) => token.symbol === symbol)?.address ?? "";
  const ask = {
    from,
    toChain: 4663,
    toToken: usdg,
    recipient: "0x000000000000000000000000000000000000dEaD",
  };
  return `- ${symbol} -> USDG on Robinhood Chain: ${await quoteRelay(ask)}`;
});
report.push("### Relay quotes for the routes its chains endpoint does not pair", ...quotes);
console.log(report.join("\n"));
