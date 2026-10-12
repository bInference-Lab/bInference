import {
  type AccountRef,
  accountRefParts,
  type AssetTransfer,
  accountRefSchema,
  assetRefParts,
  type ChainRegistry,
  type SimulatedStep,
  type TxDraft,
  type TxSimulator,
  type VenueQuote,
} from "@binference/chain";
import { type Bps, bpsPerWhole, bpsSchema, type Random } from "@binference/core";
import type { TradeQuote, VenueHost } from "../venues/venue-host.js";
import { buyTaxBps, type LegToken, lostBps, netIn } from "./leg-taxes.js";
import { sellTaxBps } from "./sale-tax.js";

/**
 * What the round trip found: the taxes it measured on each leg, a leg the token refused (its
 * transfer to a second fresh account, or the sale back), or that it could not run, such as a
 * venue that did not build the test buy or a node that did not simulate.
 */
export type RoundTrip =
  | {
      readonly kind: "measured";
      readonly buyTaxBps: Bps;
      readonly transferTaxBps: Bps;
      readonly sellTaxBps: Bps;
    }
  | { readonly kind: "refused"; readonly leg: "transfer" | "sell" }
  | { readonly kind: "unavailable" };

/** What the round trip runs on. */
export interface RoundTripOptions {
  readonly host: VenueHost;
  /** Runs the legs unsent on the chain's latest state. */
  readonly simulator: TxSimulator;
  readonly chains: ChainRegistry;
  /** Where the fresh accounts come from: new ones for every trade. */
  readonly random: Random;
}

/** One trade's round trip: its fresh accounts and the token it buys. */
interface Probe {
  readonly options: RoundTripOptions;
  readonly quoted: TradeQuote;
  readonly buyer: AccountRef;
  readonly holder: AccountRef;
  readonly token: LegToken;
  readonly signal: AbortSignal;
}

const unavailable: RoundTrip = { kind: "unavailable" };
const noTax: Bps = bpsSchema.parse(0);
// The test legs are never sent, so they accept any output: a tax must not trip a minimum.
const anyOutput: Bps = bpsSchema.parse(bpsPerWhole);
const seedBytes = 32;

function probeOf(
  quoted: TradeQuote,
  options: RoundTripOptions,
  signal: AbortSignal,
): Probe | undefined {
  const { chain: chainRef } = accountRefParts(quoted.trade.wallet);
  const chain = options.chains.get(chainRef);
  if (!chain.ok) {
    return undefined;
  }
  const { family } = chain.value;
  const fresh = (): AccountRef => family.freshAccount(chainRef, options.random.bytes(seedBytes));
  const asset = quoted.trade.assetOut;
  const contract = accountRefSchema.parse(`${chainRef}:${assetRefParts(asset).assetReference}`);
  const token = { asset, contract, family };
  return { options, quoted, buyer: fresh(), holder: fresh(), token, signal };
}

async function simulate(
  probe: Probe,
  drafts: readonly TxDraft[],
): Promise<readonly SimulatedStep[]> {
  const { trade } = probe.quoted;
  return await probe.options.simulator.simulate(drafts, {
    signal: probe.signal,
    balances: [trade.amountIn],
  });
}

// The tax a venue's own contract takes on a leg, which the leg's transfers never show.
const venueTaxOf = (quote: VenueQuote): Bps => quote.taxBps ?? noTax;
const higher = (left: Bps, right: Bps): Bps => (left > right ? left : right);

const transfersOf = (steps: readonly SimulatedStep[]): readonly AssetTransfer[] =>
  steps.flatMap((step) => step.transfers);
const hasReverted = (steps: readonly SimulatedStep[]): boolean =>
  steps.some((step) => step.status === "reverted");

// The quoted buy, built again for the fresh buyer, who pays with the trade's own input.
async function buyOf(probe: Probe): Promise<readonly TxDraft[] | undefined> {
  const trade = { ...probe.quoted.trade, wallet: probe.buyer, maxSlippageBps: anyOutput };
  const built = await probe.options.host.build(
    { ...probe.quoted, trade },
    { signal: probe.signal },
  );
  return built.ok ? built.value.steps.map((step) => step.draft) : undefined;
}

/** A sale's steps, and the tax its venue's own contract takes on it. */
interface Sale {
  readonly drafts: readonly TxDraft[];
  readonly venueTaxBps: Bps;
}

// A sale of what the holder holds back into the trade's input, quoted and built for the holder.
async function saleOf(probe: Probe, held: bigint): Promise<Sale | "no_route" | undefined> {
  const { host } = probe.options;
  const { trade } = probe.quoted;
  const sale = {
    venue: trade.venue,
    wallet: probe.holder,
    amountIn: { asset: probe.token.asset, base: held },
    assetOut: trade.amountIn.asset,
    maxSlippageBps: anyOutput,
  };
  const quoted = await host.quote(sale, { signal: probe.signal });
  if (!quoted.ok) {
    return quoted.error === "no_route" ? "no_route" : undefined;
  }
  const built = await host.build(quoted.value, { signal: probe.signal });
  return built.ok
    ? {
        drafts: built.value.steps.map((step) => step.draft),
        venueTaxBps: venueTaxOf(quoted.value.quote),
      }
    : undefined;
}

interface Legs {
  readonly buy: readonly TxDraft[];
  readonly send: TxDraft;
  readonly bought: bigint;
  readonly held: bigint;
}

// The buy, then the transfer of all it bought to the holder: what each one ended up with.
async function buyAndSend(probe: Probe): Promise<Legs | RoundTrip> {
  const buy = await buyOf(probe);
  const bought = buy === undefined ? [] : await simulate(probe, buy);
  const boughtBase = netIn(transfersOf(bought), probe.buyer, probe.token);
  if (buy === undefined || hasReverted(bought) || boughtBase <= 0n) {
    return unavailable;
  }
  const amount = { asset: probe.token.asset, base: boughtBase };
  const send = probe.token.family.transferDraft({ from: probe.buyer, to: probe.holder, amount });
  if (!send.ok) {
    return unavailable;
  }
  const sent = await simulate(probe, [...buy, send.value]);
  const held = netIn(transfersOf(sent.slice(buy.length)), probe.holder, probe.token);
  return hasReverted(sent) || held <= 0n
    ? { kind: "refused", leg: "transfer" }
    : { buy, send: send.value, bought: boughtBase, held };
}

async function roundTrip(probe: Probe): Promise<RoundTrip> {
  const legs = await buyAndSend(probe);
  if ("kind" in legs) {
    return legs;
  }
  const sale = await saleOf(probe, legs.held);
  if (sale === undefined) {
    return unavailable;
  }
  if (sale === "no_route") {
    return { kind: "refused", leg: "sell" };
  }
  const steps = await simulate(probe, [...legs.buy, legs.send, ...sale.drafts]);
  const sold = transfersOf(steps.slice(legs.buy.length + 1));
  const input = { asset: probe.quoted.trade.amountIn.asset, family: probe.token.family };
  if (hasReverted(steps) || netIn(sold, probe.holder, input) <= 0n) {
    return { kind: "refused", leg: "sell" };
  }
  const bought = transfersOf(steps.slice(0, legs.buy.length));
  const soldTax = sellTaxBps(sold, probe.holder, { sold: legs.held, token: probe.token });
  return {
    kind: "measured",
    buyTaxBps: higher(buyTaxBps(bought, probe.buyer, probe.token), venueTaxOf(probe.quoted.quote)),
    transferTaxBps: lostBps(legs.bought, legs.held),
    sellTaxBps: higher(soldTax, sale.venueTaxBps),
  };
}

/**
 * The round trip of the token a quoted trade buys (ARCHITECTURE.md section 7, step 4), from two
 * accounts made fresh for this trade, so no token can tell them from any new buyer: the first buys
 * with the trade's own input on the trade's own venue, sends all it bought to the second, and the
 * second sells it all back into that input. Each leg runs unsent on the chain's latest state,
 * accepting any output, and each leg's tax is read from the transfers it made, or is the tax the
 * leg's venue quoted as its own contract's when that is higher. A transfer that
 * reverts or delivers nothing is a refused transfer; a sale with no route, that reverts or pays
 * nothing, a refused sale. A buy the venue will not build, that reverts or buys nothing is
 * `unavailable`, since the trade's own simulation decides whether the wallet can buy. When the
 * chain cannot simulate, it rejects.
 */
export async function probeRoundTrip(
  quoted: TradeQuote,
  options: RoundTripOptions,
  signal: AbortSignal,
): Promise<RoundTrip> {
  const probe = probeOf(quoted, options, signal);
  return probe === undefined ? unavailable : await roundTrip(probe);
}
