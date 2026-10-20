import { assetRefSchema, chainRefSchema } from "@binference/chain";
import { bsc } from "@binference/chains";
import type { LaunchTerms } from "@binference/protocol";
import { rescueAddress } from "../e2e/init-fixtures.js";
import { crashUsdt } from "./crash-market.js";

/** What a crash launch's first buy spends: the chain's coin, or the registry's USDT. */
export type CrashLaunchPair = "coin" | "usdt";

/** What each pair's first buy spends: 0.01 BNB, or six dollars of USDT. */
export const crashFirstBuys: Readonly<Record<CrashLaunchPair, bigint>> = {
  coin: 10n ** 16n,
  usdt: 6n * 10n ** 18n,
};

const bscRef = chainRefSchema.parse(bsc.id);
const pairs = {
  coin: assetRefSchema.parse(`${bscRef}/slip44:714`),
  usdt: assetRefSchema.parse(`${bscRef}/erc20:${crashUsdt}`),
};

/**
 * The launch every crash run makes, as the owner or the agent words it: Crash Cat on Flap, a tax
 * token paid to the install's rescue address, with a first buy against the pair.
 */
export function crashLaunchTerms(pair: CrashLaunchPair): LaunchTerms {
  const pairWith = pairs[pair];
  return {
    reason: "The owner asked for a token named Crash Cat on Flap.",
    venue: "flap",
    name: "Crash Cat",
    symbol: "CCAT",
    description: "A cat launched through a forced stop",
    links: { website: "https://crash.example" },
    pairWith,
    firstBuy: { asset: pairWith, base: crashFirstBuys[pair] },
    venueOptions: {
      buyTaxBps: 300,
      sellTaxBps: 500,
      taxRecipient: rescueAddress,
      burnShareBps: 1_000,
      taxDays: 365,
    },
  };
}
