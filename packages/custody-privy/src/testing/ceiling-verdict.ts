import type { Hex } from "viem";
import { buildCeiling } from "../ceiling/build-ceiling.js";
import type { CeilingRequest } from "../ceiling/ceiling.js";
import { policyRuleJson } from "../ceiling/policy-rule.js";
import { evaluatePolicy } from "./fake-policy-engine.js";
import { fakePolicyBodySchema } from "./fake-privy-request.schema.js";

/** A transaction a wallet asks Privy to sign, as the fake's policy engine reads it. */
export interface CeilingTx {
  readonly chainId: bigint;
  readonly to: string;
  readonly valueWei: bigint;
  readonly data: Hex;
  /** The signing wallet, which `{{wallet.address}}` names. */
  readonly walletAddress: string;
}

/**
 * What the ceiling the request builds answers a signature under Privy's policy semantics, on the
 * fake's policy engine, as the wallet's first transaction of the day: each 24-hour cap counts the
 * transaction's own native value, or its approval, alone. A request no ceiling builds throws.
 */
export function ceilingVerdict(request: CeilingRequest, tx: CeilingTx): "ALLOW" | "DENY" {
  const ceiling = buildCeiling(request);
  if (!ceiling.ok) {
    throw new Error(`The request builds no ceiling: ${ceiling.error}.`);
  }
  const body = {
    version: "1.0",
    name: "binference ceiling",
    chain_type: "ethereum",
    rules: ceiling.value.rules.map(policyRuleJson),
  };
  const { rules } = fakePolicyBodySchema.parse(body);
  const native = new Set(request.chains.map((chain) => chain.caps.native.aggregation));
  return evaluatePolicy(rules, { method: "eth_signTransaction", ...tx }, (aggregation, input) =>
    native.has(aggregation) ? input.valueWei : 0n,
  );
}
