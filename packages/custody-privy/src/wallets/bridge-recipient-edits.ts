import { err, ok, type Result } from "@binference/core";
import type { AddressProblem } from "../ceiling/address-list.js";
import { bridgedOf, bridgeTargetsOf } from "../ceiling/bridge-recipients.js";
import { bridgeRules, checkedTargets } from "../ceiling/bridge-rules.js";
import type { ChainAddresses } from "../ceiling/ceiling.js";
import { heldRules } from "../ceiling/held-rules.schema.js";
import type { PolicyRule } from "../ceiling/policy-rule.js";
import { heldBridgeChainsOf, isBridgeRuleName } from "../ceiling/read-bridge-rules.js";
import type { PolicyRuleRef } from "../privy/privy-wire.schema.js";
import type { RuleEdits } from "./rule-plans.js";

/** What a ceiling's bridge rules may pay after a change of its recipients. */
export interface BridgeRecipients {
  /** Per chain, every address the owner key lets the wallet pay there. */
  readonly recipients: readonly ChainAddresses[];
  /** Per destination, the addresses a bridge may pay there; absent, the ones it pays now. */
  readonly bridged?: readonly ChainAddresses[];
}

// Each chain's bridge rules rebuilt to pay the addresses still listed for each destination, checked
// as the first build checks them: checksummed, of the length each recipient input takes, at most
// 100 a destination. A target that fails is refused as the change of calls refuses it.
function rebuiltBodies(
  chains: NonNullable<ReturnType<typeof heldBridgeChainsOf>>,
  change: BridgeRecipients,
): Result<readonly PolicyRule[], AddressProblem | "not_found"> {
  const bodies: PolicyRule[] = [];
  for (const { chainId, targets } of chains) {
    const bridged = change.bridged ?? bridgedOf(targets);
    const rebuilt = bridgeTargetsOf(targets, { recipients: change.recipients, bridged });
    const checked = checkedTargets(rebuilt, chainId);
    if (!checked.ok) {
      const { error } = checked;
      return err(
        error === "malformed_address" || error === "too_many_addresses" ? error : "not_found",
      );
    }
    bodies.push(...checked.value.flatMap((target) => bridgeRules(target, chainId)));
  }
  return ok(bodies);
}

/**
 * The edits that keep a policy's bridge rules within new recipients (decision 0302): each held
 * deposit rebuilt to pay only the addresses `bridged` names for its destination that are still a
 * recipient of that destination, checked and checksummed as the first build does, a rule that
 * holds them already left as it is, and a destination left with none taken out. A deposit no rule
 * holds yet is never added here: its first rule comes with a change of the ceiling's calls. Bridge
 * rules that cannot be read are `not_found`, so a removed address never stays payable through a
 * rule this cannot rebuild; an address a rule cannot list is refused as `addressList` refuses it.
 */
export function bridgeRecipientEdits(
  refs: readonly PolicyRuleRef[],
  change: BridgeRecipients,
): Result<RuleEdits, AddressProblem | "not_found"> {
  const held = refs.filter((ref) => isBridgeRuleName(ref.name));
  if (held.length === 0) {
    return ok({ writes: [], adds: [], removes: [] });
  }
  const read = heldRules(held.map((ref) => ref.json));
  const chains = read === undefined ? undefined : heldBridgeChainsOf(read);
  if (chains === undefined) {
    return err("not_found");
  }
  const rebuilt = rebuiltBodies(chains, change);
  if (!rebuilt.ok) {
    return rebuilt;
  }
  const bodies = rebuilt.value;
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
