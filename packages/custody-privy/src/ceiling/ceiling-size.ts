import type { JsonValue } from "@binference/core";
import { heldRules } from "./held-rules.schema.js";
import { type PolicyRule, policyRuleJson } from "./policy-rule.js";

/**
 * The most bytes a ceiling's rules may take as Privy's JSON. Privy took a policy of 492,666 bytes
 * and refused one of 506,607 with a 403, whatever its count of rules: it took 400 small rules
 * (probe 1 in `ceiling-probes.live.test.ts`, on its test app, 2026-10-31). This keeps a margin below
 * what it took.
 */
export const maxCeilingBytes = 480_000;

// Privy's `in` operator takes at most 100 values.
const maxListed = 100;

// What one more address adds to a rule's list: the quoted address and its comma.
const addressBytes = 45;

/** How many bytes rules take as the JSON Privy's API takes. */
export function ceilingBytes(rules: readonly PolicyRule[]): number {
  return JSON.stringify(rules.map(policyRuleJson)).length;
}

/**
 * How many more addresses the bridge rules of a ceiling to one destination can list (decision
 * 0302): the fewest any of them has left under Privy's 100, and no more than the bytes the
 * ceiling has left allow, each address added to every such rule. A destination no bridge rule
 * names, or rules this cannot read, have no room here: a first address there adds a whole rule,
 * which the build measures.
 */
export function bridgeRoom(rules: readonly JsonValue[], destinationChainId: string): number {
  const suffix = ` to ${destinationChainId}`;
  const targets = (heldRules(rules) ?? []).filter(
    (rule) => rule.name.startsWith("Bridge ") && rule.name.endsWith(suffix),
  );
  if (targets.length === 0) {
    return 0;
  }
  const listed = targets.map((rule) => {
    const recipients = rule.conditions.find((item) => item.field.endsWith(".recipient"));
    return typeof recipients?.value === "object" ? recipients.value.length : maxListed;
  });
  const bytesLeft = maxCeilingBytes - JSON.stringify(rules).length;
  const byBytes = Math.floor(Math.max(bytesLeft, 0) / (addressBytes * targets.length));
  return Math.max(0, Math.min(maxListed - Math.max(...listed), byBytes));
}
