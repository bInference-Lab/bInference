import type { BridgeRouteDefinition, ChainDefinition } from "@binference/chain";
import { z } from "zod";
import { readJson, readParsed } from "./live-parts.mjs";

const acrossRoutesSchema = z.array(
  z.looseObject({
    originChainId: z.number(),
    destinationChainId: z.number(),
    destinationToken: z.string(),
    originTokenSymbol: z.string(),
    destinationTokenSymbol: z.string(),
  }),
);

const currencySchema = z.looseObject({
  id: z.string(),
  symbol: z.string(),
  address: z.string(),
  supportsBridging: z.boolean().optional(),
});

const relayChainSchema = z.looseObject({
  id: z.number(),
  tokenSupport: z.string().optional(),
  currency: currencySchema,
  erc20Currencies: z.array(currencySchema).default([]),
});

const relayChainsSchema = z.looseObject({ chains: z.array(relayChainSchema) });

const relayQuoteSchema = z.looseObject({
  details: z.looseObject({
    currencyOut: z.looseObject({
      amount: z.string(),
      currency: z.looseObject({ symbol: z.string() }),
    }),
  }),
});

const acrossErrorSchema = z.looseObject({ code: z.string(), message: z.string() });

type RelayChain = z.infer<typeof relayChainSchema>;
type Currency = z.infer<typeof currencySchema>;

/** A chain the routes are read for: its registry entry and its id in each bridge's API. */
export interface RouteChain {
  readonly definition: ChainDefinition;
  readonly acrossId: number;
  readonly relayId: number;
}

/** The routes in the registry, and the chains to read them for. */
export interface RouteRead {
  readonly chains: readonly RouteChain[];
  readonly registry: readonly BridgeRouteDefinition[];
}

const bscId = 56;

function registryLine(read: RouteRead, venue: string, chain: ChainDefinition): string {
  const ours = read.registry.filter((item) => item.venue === venue && item.to === chain.key);
  const listed = ours.map((item) => `${item.leaves} -> ${item.arrives}`).join(", ");
  return `  - in the registry: ${listed === "" ? "none" : listed} (read ${ours[0]?.checkedOn ?? "-"})`;
}

/** What Across's available-routes endpoint lists from BSC today, against the registry. */
export async function readAcrossRoutes(read: RouteRead): Promise<string[]> {
  const url = `https://app.across.to/api/available-routes?originChainId=${String(bscId)}`;
  const routes = await readParsed(acrossRoutesSchema, url);
  const lines = [
    `### Across, from its available-routes endpoint: ${String(routes.length)} routes from BSC`,
  ];
  if (routes.length === 0) {
    const limits = acrossErrorSchema.safeParse(
      await readJson(
        "https://app.across.to/api/limits?inputToken=0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" +
          "&outputToken=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913&originChainId=56&destinationChainId=8453",
      ),
    );
    lines.push(
      `- its limits for BSC USDC to Base USDC: ${limits.success ? limits.data.code : "a limit"}`,
    );
  }
  for (const { definition, acrossId } of read.chains) {
    const listed = routes.filter(({ destinationChainId }) => destinationChainId === acrossId);
    const names = listed.map(
      (route) => `${route.originTokenSymbol} -> ${route.destinationTokenSymbol}`,
    );
    lines.push(
      `- ${definition.name}: ${names.join(", ") || "none today"}`,
      registryLine(read, "across", definition),
    );
  }
  return lines;
}

function bridging(chain: RelayChain | undefined): Currency[] {
  return chain === undefined
    ? []
    : [chain.currency, ...chain.erc20Currencies].filter(
        ({ supportsBridging }) => supportsBridging === true,
      );
}

/** Every currency Relay's chains endpoint bridges from BSC to each chain, against the registry. */
export async function readRelayRoutes(read: RouteRead): Promise<string[]> {
  const { chains } = await readParsed(relayChainsSchema, "https://api.relay.link/chains");
  const bscChain = chains.find(({ id }) => id === bscId);
  const leaving = bridging(bscChain);
  const lines = [
    "### Relay, from its chains endpoint",
    `- BSC (tokenSupport ${bscChain?.tokenSupport ?? "-"}) bridges ${leaving.map(({ symbol }) => symbol).join(", ")}`,
  ];
  for (const { definition, relayId } of read.chains) {
    const entry = chains.find(({ id }) => id === relayId);
    const arriving = bridging(entry);
    const pairs = arriving
      .filter((item) => leaving.some((left) => left.id === item.id))
      .map(({ symbol, address }) => `${symbol} ${address}`);
    lines.push(
      `- ${definition.name} (tokenSupport ${entry?.tokenSupport ?? "-"}) bridges ` +
        `${arriving.map(({ symbol }) => symbol).join(", ")}; the same currency on both chains: ` +
        (pairs.join(", ") || "none"),
      registryLine(read, "relay", definition),
    );
  }
  return lines;
}

/** A route to ask Relay's quote endpoint for. */
export interface RelayAsk {
  readonly from: string;
  readonly toChain: number;
  readonly toToken: string;
  readonly recipient: string;
}

/** Asks Relay's quote endpoint for 20 of a BSC stablecoin, from a burn address that holds nothing. */
export async function quoteRelay(ask: RelayAsk): Promise<string> {
  const answer = relayQuoteSchema.safeParse(
    await readJson("https://api.relay.link/quote/v2", {
      user: "0x000000000000000000000000000000000000dEaD",
      recipient: ask.recipient,
      originChainId: bscId,
      destinationChainId: ask.toChain,
      originCurrency: ask.from,
      destinationCurrency: ask.toToken,
      amount: "20000000000000000000",
      tradeType: "EXACT_INPUT",
    }),
  );
  if (!answer.success) {
    return "no quote";
  }
  const { amount, currency } = answer.data.details.currencyOut;
  return `quoted: 20 in, ${amount} ${currency.symbol} base units out`;
}
