import { err, ok, type Result } from "@binference/core";
import { bridgedOf, bridgeTargetsOf } from "../ceiling/bridge-recipients.js";
import { bridgeRules } from "../ceiling/bridge-rules.js";
import type { BridgedAddresses } from "../ceiling/ceiling.js";
import { heldRules } from "../ceiling/held-rules.schema.js";
import type { PolicyRule } from "../ceiling/policy-rule.js";
import { heldBridgeChainsOf, isBridgeRuleName } from "../ceiling/read-bridge-rules.js";
import type { PolicyRuleRef } from "../privy/privy-wire.schema.js";
import type { RuleEdits } from "./rule-plans.js";

/** What a ceiling's bridge rules may pay after a change of its recipients. */
export interface BridgeRecipients {
  /** The rescue address and the saved addresses, checksummed: every address a send may pay. */
  readonly recipients: readonly string[];
  /** Per destination, the addresses a bridge may pay there; absent, the ones it pays now. */
  readonly bridged?: readonly BridgedAddresses[];
}

/**
 * The edits that keep a policy's bridge rules within new recipients (decision 0302): each held
 * deposit rebuilt to pay only the addresses `bridged` names for its destination that are still a
 * recipient, a rule that holds them already left as it is, and a destination left with none taken
 * out. A deposit no rule holds yet is never added here: its first rule comes with a change of the
 * ceiling's calls. Bridge rules that cannot be read are `not_found`, so a removed address never stays
 * payable through a rule this cannot rebuild.
 */
export function bridgeRecipientEdits(
  refs: readonly PolicyRuleRef[],
  change: BridgeRecipients,
): Result<RuleEdits, "not_found"> {
  const held = refs.filter((ref) => isBridgeRuleName(ref.name));
  if (held.length === 0) {
    return ok({ writes: [], adds: [], removes: [] });
  }
  const read = heldRules(held.map((ref) => ref.json));
  const chains = read === undefined ? undefined : heldBridgeChainsOf(read);
  if (chains === undefined) {
    return err("not_found");
  }
  const bodies = chains.flatMap(({ chainId, targets }): readonly PolicyRule[] => {
    const bridged = change.bridged ?? bridgedOf(targets);
    const rebuilt = bridgeTargetsOf(targets, { recipients: change.recipients, bridged });
    return rebuilt.flatMap((target) => bridgeRules(target, chainId));
  });
  const named = (name: string) => held.find((ref) => ref.name === name);
  return ok({
    writes: bodies.flatMap((body) => {
      const ref = named(body.name);
      return ref === undefined ? [] : [{ ref, body }];
    }),
    adds: bodies.filter((body) => named(body.name) === undefined),
    removes: held.filter((ref) => !bodies.some((body) => body.name === ref.name)),
  });
}
