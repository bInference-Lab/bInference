import { type PolicyRule, policyRuleJson } from "./policy-rule.js";

/**
 * The most bytes a ceiling's rules may take as Privy's JSON. Privy took a policy of 492,666 bytes
 * and refused one of 506,607 with a 403, whatever its count of rules: it took 400 small rules
 * (probe 1 in `ceiling-probes.live.test.ts`, on its test app, 2026-10-31). This keeps a margin
 * below what it took.
 */
export const maxCeilingBytes = 480_000;

/** How many bytes rules take as the JSON Privy's API takes. */
export function ceilingBytes(rules: readonly PolicyRule[]): number {
  return JSON.stringify(rules.map(policyRuleJson)).length;
}
