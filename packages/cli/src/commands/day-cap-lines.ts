import { type AssetRef, assetRefParts } from "@binference/chain";
import type { CeilingView, DayCapView } from "@binference/protocol";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import type { CommandRun } from "../program/command-run.js";

/** What a cap counts, read from the registry of a chain this binference serves. */
interface CappedAsset {
  readonly symbol: string;
  readonly decimals: number;
  /** Whether the cap counts the native coin sent, rather than a token's approvals. */
  readonly isNative: boolean;
}

function cappedAsset(asset: AssetRef): CappedAsset | undefined {
  const { chain, assetNamespace, assetReference } = assetRefParts(asset);
  const served = selfHostedChains().get(chain);
  if (!served.ok) {
    return undefined;
  }
  const { nativeAsset, tokens } = served.value.definition;
  if (
    nativeAsset.assetNamespace === assetNamespace &&
    nativeAsset.assetReference === assetReference
  ) {
    return { symbol: nativeAsset.symbol, decimals: nativeAsset.decimals, isNative: true };
  }
  const token = tokens.find((item) => item.address.toLowerCase() === assetReference.toLowerCase());
  return token === undefined
    ? undefined
    : { symbol: token.symbol, decimals: token.decimals, isNative: false };
}

function printCap(run: CommandRun, cap: DayCapView): void {
  const { formatter, output } = run;
  const hours = cap.windowSeconds / 3_600;
  const usd = formatter.usd(cap.floorUsdMicros);
  const known = cappedAsset(cap.asset);
  if (known === undefined) {
    const values = { amount: String(cap.limit), asset: cap.asset, hours, usd };
    output.item("ceiling.dayCapBase", values);
    return;
  }
  const amount = formatter.tokenAmount(cap.limit, known.decimals);
  const values = { amount, symbol: known.symbol, hours, usd };
  output.item(known.isNative ? "ceiling.dayCapSent" : "ceiling.dayCapApproved", values);
}

/**
 * Prints a ceiling's 24-hour caps under their heading (decision 0149): what each counts, its size
 * in the asset's units and in dollars at the floor price, and its window. An asset of a chain
 * this binference does not serve is shown in base units.
 */
export function printDayCaps(run: CommandRun, ceiling: CeilingView): void {
  const caps = ceiling.dayCaps ?? [];
  run.output.say("ceiling.dayCaps", { count: caps.length });
  for (const cap of caps) {
    printCap(run, cap);
  }
}
