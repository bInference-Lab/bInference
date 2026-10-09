import { orderedFlags, type RiskFlagCode, type TokenRiskReport } from "@binference/plugin-sdk";
import type { GoplusToken } from "./api/token-security.schema.js";

// Each GoPlus flag that reports a finding when it is "1".
const whenSet: readonly (readonly [string, RiskFlagCode])[] = [
  ["is_honeypot", "honeypot"],
  ["cannot_sell_all", "cannot_sell_all"],
  ["cannot_buy", "cannot_buy"],
  ["hidden_owner", "hidden_owner"],
  ["owner_change_balance", "owner_changes_balances"],
  ["can_take_back_ownership", "owner_reclaims"],
  ["is_blacklisted", "blacklist"],
  ["is_whitelisted", "whitelist"],
  ["transfer_pausable", "transfer_pausable"],
  ["slippage_modifiable", "tax_changeable"],
  ["personal_slippage_modifiable", "tax_per_holder"],
  ["trading_cooldown", "trading_cooldown"],
  ["is_anti_whale", "holding_cap"],
  ["is_mintable", "mintable"],
  ["is_proxy", "proxy"],
  ["selfdestruct", "self_destruct"],
  ["is_airdrop_scam", "airdrop_scam"],
];

// GoPlus writes a whole tax as "1": a tax of 100%, or a trade that cannot happen.
const wholeTax = /^1(?:\.0*)?$/;
const usdText = /^(\d+)(?:\.(\d*))?$/;
const microsPerUsd = 1_000_000n;

function isSet(token: GoplusToken, field: string): boolean {
  return token.flags[field] === "1";
}

// Only "0" means closed source or a fake token: a missing field means GoPlus does not know.
function isUnset(token: GoplusToken, field: string): boolean {
  return token.flags[field] === "0";
}

function findingsOf(token: GoplusToken): readonly RiskFlagCode[] {
  const found = whenSet.flatMap(([field, code]) => (isSet(token, field) ? [code] : []));
  const extra: readonly (readonly [boolean, RiskFlagCode])[] = [
    [wholeTax.test(token.sellTax ?? ""), "cannot_sell"],
    [wholeTax.test(token.buyTax ?? ""), "cannot_buy"],
    [isUnset(token, "is_open_source"), "closed_source"],
    [isUnset(token, "is_true_token") || token.isFake, "fake_token"],
  ];
  return orderedFlags([...found, ...extra.flatMap(([isFound, code]) => (isFound ? [code] : []))]);
}

// USD text such as "3575746.55849566" in micro-dollars, the cents past a micro-dollar dropped.
function microsOf(usd: string): bigint | undefined {
  const match = usdText.exec(usd);
  if (match === null) {
    return undefined;
  }
  const [, whole = "0", fraction = ""] = match;
  return BigInt(whole) * microsPerUsd + BigInt(fraction.slice(0, 6).padEnd(6, "0"));
}

/**
 * Reads one token of GoPlus's answer into a risk report: each flag GoPlus sets, a whole sell or
 * buy tax as `cannot_sell` or `cannot_buy`, and the liquidity of every pool it lists, added up.
 * GoPlus counts only pools against the tokens it calls mainstream, so the sum is a floor. A pool
 * whose liquidity is not decimal text counts nothing.
 */
export function goplusReport(token: GoplusToken): TokenRiskReport {
  const pools = token.liquidities.flatMap((usd) => {
    const micros = microsOf(usd);
    return micros === undefined ? [] : [micros];
  });
  const flags = findingsOf(token);
  return pools.length === 0
    ? { flags }
    : { flags, liquidityUsdMicros: pools.reduce((sum, micros) => sum + micros, 0n) };
}
