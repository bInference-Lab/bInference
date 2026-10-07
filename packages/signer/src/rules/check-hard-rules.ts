import type { AuthorizeInput } from "@binference/chain";
import type { SignerSettings } from "../process/signer-settings.schema.js";
import { authorizationHolds } from "./authorization-rule.js";
import { chainHolds } from "./chain-rule.js";
import { readPrivyCall } from "./evm-transaction.schema.js";
import type { HardRule, RuleView } from "./hard-rule.js";
import { methodHolds } from "./method-rule.js";
import { replacementHolds } from "./replacement-rule.js";
import { targetHolds } from "./target-rule.js";
import { valueHolds } from "./value-rule.js";

/** Why the hard rules refuse a request: a broken rule by its number, or a body they cannot read. */
export type HardRuleRefusal = `rule_${HardRule}` | "malformed";

const rules: readonly (readonly [HardRule, (view: RuleView) => boolean])[] = [
  [1, chainHolds],
  [2, targetHolds],
  [3, valueHolds],
  [4, methodHolds],
  [5, authorizationHolds],
  [6, replacementHolds],
];

/** What the hard rules read besides the request: the settings and the time. */
export interface HardRuleContext {
  readonly settings: SignerSettings;
  /** Now, in epoch milliseconds. */
  readonly nowMs: number;
}

/**
 * Every hard rule of the keys spec, section 5.2, that a request to authorize breaks, in rule
 * order, checked against the transaction read out of its Privy body: `[4]` for a body of another
 * method, `malformed` for a body the rules cannot read, and none when every rule holds.
 */
export function brokenHardRules(
  input: AuthorizeInput,
  context: HardRuleContext,
): readonly HardRule[] | "malformed" {
  const call = readPrivyCall(input.request.body);
  if (call.kind === "unreadable") {
    return "malformed";
  }
  if (call.kind === "otherMethod") {
    return [4];
  }
  const view: RuleView = { input, transaction: call.transaction, ...context };
  return rules.filter(([, holds]) => !holds(view)).map(([rule]) => rule);
}

/**
 * Checks the hard rules on a request to authorize. Returns the first rule it breaks, as
 * `rule_<n>`, `malformed` for a body the rules cannot read, or `undefined` when every rule holds.
 */
export function checkHardRules(
  input: AuthorizeInput,
  context: HardRuleContext,
): HardRuleRefusal | undefined {
  const broken = brokenHardRules(input, context);
  if (broken === "malformed") {
    return broken;
  }
  const [first] = broken;
  return first === undefined ? undefined : `rule_${first}`;
}
