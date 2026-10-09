import { orderedFlags, type RiskFlagCode, type TokenRiskReport } from "@binference/plugin-sdk";
import type { HoneypotAnswer } from "./api/is-honeypot.schema.js";

// The summary flags of honeypot.is's docs that the source reports, by the finding each one is.
const summaryFindings: Readonly<Record<string, RiskFlagCode>> = {
  high_fail_rate: "sell_failures",
  medium_fail_rate: "sell_failures",
  low_fail_rate: "sell_failures",
  high_siphon_rate: "siphoned",
  medium_siphon_rate: "siphoned",
  transfer_blocked: "transfer_blocked",
  closed_source: "closed_source",
  effective_honeypot_low_sell_limit: "sell_limit",
  extremely_low_sell_limit: "sell_limit",
  low_sell_limit: "sell_limit",
  one_sell_per_block_limit: "sell_limit",
};
// honeypot.is's risk levels: from 60 a high risk, from 90 a honeypot.
const highRiskLevel = 60;
const honeypotLevel = 90;
// honeypot.is writes taxes in percent: 100 is a trade that cannot happen.
const wholePercent = 100;
const microsPerUsd = 1_000_000;

function findingsOf(answer: HoneypotAnswer): readonly RiskFlagCode[] {
  const level = answer.riskLevel ?? 0;
  const found: readonly (readonly [boolean, RiskFlagCode])[] = [
    [
      answer.isHoneypot === true || answer.risk === "honeypot" || level >= honeypotLevel,
      "honeypot",
    ],
    [(answer.sellTax ?? 0) >= wholePercent, "cannot_sell"],
    [(answer.buyTax ?? 0) >= wholePercent, "cannot_buy"],
    [answer.hasSellLimit, "sell_limit"],
    [answer.isOpenSource === false, "closed_source"],
    [answer.isProxy === true, "proxy"],
    [level >= highRiskLevel, "high_risk"],
  ];
  const summary = answer.flags.flatMap((flag) => {
    const code = summaryFindings[flag];
    return code === undefined ? [] : [code];
  });
  return orderedFlags([...found.flatMap(([isFound, code]) => (isFound ? [code] : [])), ...summary]);
}

/**
 * Reads honeypot.is's answer into a risk report: its honeypot verdict, a sale or buy its test
 * trade could not make (a tax of 100%), a sale limit, code it cannot read, a proxy, a risk level of
 * 60 or more, and the summary flags its docs list. The tested pair's liquidity, a JSON number of
 * USD, becomes micro-dollars rounded down; it is a floor, since honeypot.is counts one pair.
 */
export function honeypotReport(answer: HoneypotAnswer): TokenRiskReport {
  const flags = findingsOf(answer);
  const usd = answer.liquidityUsd;
  return usd === undefined || !Number.isFinite(usd)
    ? { flags }
    : { flags, liquidityUsdMicros: BigInt(Math.floor(usd * microsPerUsd)) };
}
