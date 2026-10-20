import { type Address, type Hex, pad, zeroAddress } from "viem";
import { type NewTokenArgs, newTokenCallData } from "../portal/launch-call.js";

// What every Flap launch of this venue writes beyond its settings (decision 0271): a Tax Token V3
// (`tokenVersion` 6), which must migrate to a V2-style pool, at Flap's default threshold of 80% of
// the supply on the curve (`FOUR_FIFTHS`), to the chain's first DEX, with no extension, no permit,
// no dividend or liquidity share, no anti-farmer wait and no commission receiver.
const taxTokenV3 = 6;
const fourFifths = 1;
const v2Migrator = 1;
const firstDex = 0;
const standardLpFee = 0;
const noExtension: Hex = pad("0x", { size: 32 });
const wholeShareBps = 10_000;
const secondsPerDay = 86_400n;

/** A Flap launch's settings, as its create call writes them. */
export interface FlapLaunchSettings {
  readonly buyTaxBps: number;
  readonly sellTaxBps: number;
  readonly taxRecipient: Address;
  readonly burnShareBps: number;
  readonly taxDays: number;
}

/** What a create call makes beyond its settings: the token's words, its pair, its first buy. */
export interface CreateTerms {
  readonly name: string;
  readonly symbol: string;
  readonly meta: string;
  readonly salt: Hex;
  /** The pair, as the Portal names it: the zero address for the chain's coin. */
  readonly quoteToken: Address;
  /** The first buy's spend, in base units of the pair; 0 for none. */
  readonly quoteAmt: bigint;
}

/** The arguments of the create call of a launch with these terms and settings. */
export function newTokenArgsFor(terms: CreateTerms, settings: FlapLaunchSettings): NewTokenArgs {
  const { quoteToken } = terms;
  return {
    ...terms,
    dexThresh: fourFifths,
    migratorType: v2Migrator,
    beneficiary: settings.taxRecipient,
    permitData: "0x",
    extensionID: noExtension,
    extensionData: "0x",
    dexId: firstDex,
    lpFeeTier: standardLpFee,
    buyTaxRate: settings.buyTaxBps,
    sellTaxRate: settings.sellTaxBps,
    taxDuration: BigInt(settings.taxDays) * secondsPerDay,
    antiFarmerDuration: 0n,
    mktBps: wholeShareBps - settings.burnShareBps,
    deflationBps: settings.burnShareBps,
    dividendBps: 0,
    lpBps: 0,
    minimumShareBalance: 0n,
    // The Portal takes the zero address as the coin's dividend only against the coin; against a
    // token it must be that token.
    dividendToken: quoteToken,
    commissionReceiver: zeroAddress,
    tokenVersion: taxTokenV3,
  };
}

/**
 * The terms and settings a create call writes, when it is one this venue builds: every fixed value
 * as {@link newTokenArgsFor} writes it, and a tax that lasts whole days. Any other call: undefined.
 */
export function createOfArgs(
  args: NewTokenArgs,
): { readonly terms: CreateTerms; readonly settings: FlapLaunchSettings } | undefined {
  const { taxDuration, deflationBps } = args;
  if (taxDuration % secondsPerDay !== 0n || deflationBps > wholeShareBps) {
    return undefined;
  }
  const terms: CreateTerms = {
    name: args.name,
    symbol: args.symbol,
    meta: args.meta,
    salt: args.salt,
    quoteToken: args.quoteToken,
    quoteAmt: args.quoteAmt,
  };
  const settings: FlapLaunchSettings = {
    buyTaxBps: args.buyTaxRate,
    sellTaxBps: args.sellTaxRate,
    taxRecipient: args.beneficiary,
    burnShareBps: deflationBps,
    taxDays: Number(taxDuration / secondsPerDay),
  };
  // A call is ours when the venue would write the same bytes for what it reads.
  const isOurs = newTokenCallData(newTokenArgsFor(terms, settings)) === newTokenCallData(args);
  return isOurs ? { terms, settings } : undefined;
}
