import type { ChainRegistry, RegisteredChain, TxDraft } from "@binference/chain";
import { planDocument } from "../intents/intent-documents.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import type { ChainSending } from "./executor-options.js";

/** A confirmed intent's steps, the one chain they run on, and that chain's sending parts. */
export interface IntentPlan {
  readonly steps: readonly [TxDraft, ...TxDraft[]];
  readonly chain: RegisteredChain;
  readonly sending: ChainSending;
}

/** Why the executor cannot run an intent's plan. */
export type PlanProblem = "no_plan" | "chains_differ" | "unknown_chain" | "no_relays";

/** What a plan is read against. */
export interface PlanSources {
  readonly chains: ChainRegistry;
  readonly sending: ReadonlyMap<string, ChainSending>;
}

/**
 * Reads a stored intent's plan: every step from the intent's wallet on one chain the registry
 * holds, with sending parts for that chain. Anything else is a problem the intent keeps
 * `confirmed` for, since nothing has been signed.
 */
export function intentPlanOf(
  record: IntentRecord,
  sources: PlanSources,
): { readonly plan: IntentPlan } | { readonly problem: PlanProblem } {
  if (record.plan === undefined) {
    return { problem: "no_plan" };
  }
  const [first, ...rest] = planDocument.decode(record.plan);
  if (first === undefined || rest.some((step) => step.chain !== first.chain)) {
    return { problem: "chains_differ" };
  }
  const chain = sources.chains.get(first.chain);
  if (!chain.ok) {
    return { problem: "unknown_chain" };
  }
  const sending = sources.sending.get(first.chain);
  return sending === undefined
    ? { problem: "no_relays" }
    : { plan: { steps: [first, ...rest], chain: chain.value, sending } };
}
