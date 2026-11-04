import type { ChainRegistry } from "@binference/chain";
import type { Bps } from "@binference/core";
import { quoteDocument, riskDocument } from "../intents/intent-documents.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { assetInfoOf } from "./asset-infos.js";

/** The parts of a trade's stored intent its token risk warnings are read from. */
export type RiskWarningSource = Pick<IntentRecord, "quote" | "risk">;

/**
 * The highest tax the risk step measured on the token a trade buys, on either leg, which the
 * card's `card.warn.highTax` line shows; `undefined` when the risk step measured none.
 */
export function measuredTaxOf(record: RiskWarningSource): Bps | undefined {
  const risk = record.risk === undefined ? undefined : riskDocument.decode(record.risk);
  const taxes = [risk?.buyTaxBps, risk?.sellTaxBps].filter((tax) => tax !== undefined);
  return taxes.reduce<Bps | undefined>(
    (max, tax) => (max === undefined || tax > max ? tax : max),
    undefined,
  );
}

/**
 * Whether a trade buys a token with a risk warning (decision 0363): a token the chain registry does
 * not list, which the card marks `card.warn.unverified`; a tax the risk step measured, which it
 * shows as `card.warn.highTax`; or any other finding that made the risk verdict `warn`. A trade
 * with no stored quote counts as warned, so a doubt asks.
 */
export function hasTokenRiskWarning(record: RiskWarningSource, chains: ChainRegistry): boolean {
  if (record.quote === undefined) {
    return true;
  }
  const bought = quoteDocument.decode(record.quote).minOut.asset;
  const risk = record.risk === undefined ? undefined : riskDocument.decode(record.risk);
  const tax = measuredTaxOf(record);
  return (
    assetInfoOf(chains, bought) === undefined ||
    risk?.verdict === "warn" ||
    (tax !== undefined && tax > 0)
  );
}
