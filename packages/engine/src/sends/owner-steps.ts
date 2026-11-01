import type { Result } from "@binference/core";
import type { SimulationView } from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { simulationDocument } from "../intents/intent-documents.schema.js";
import type { SimulationFailure } from "../intents/intent-reason.js";
import { type AdvanceParts, advanceIntent } from "../money-path/advance-intent.js";
import { authorizationCheckOf } from "../money-path/authorization-check-of.js";
import type { WalletFacts } from "../money-path/wallet-facts.js";
import type { PolicyPass, PolicyVerdict } from "../policy/check-policy.js";

/**
 * Moves a proposed send, revoke or bridge by its policy verdict: to `rejected_policy` with the
 * first reason broken, or to `checked` with the pass the caps were counted with.
 */
export async function advanceByVerdict(
  advance: AdvanceParts,
  proposed: IntentSnapshot,
  verdict: PolicyVerdict,
): Promise<{ readonly snapshot: IntentSnapshot; readonly pass?: PolicyPass }> {
  if (!verdict.ok) {
    const trigger = { type: "policy_refused", reason: verdict.error } as const;
    return { snapshot: await advanceIntent(advance, proposed, { trigger }) };
  }
  const checked = await advanceIntent(advance, proposed, { trigger: { type: "policy_passed" } });
  return checked.record.state === "checked"
    ? { snapshot: checked, pass: verdict.value }
    : { snapshot: checked };
}

/** Moves an assessed intent by its simulation: to `simulated` with its view, or `failed_check`. */
export async function advanceBySimulation(
  advance: AdvanceParts,
  assessed: IntentSnapshot,
  simulation: Result<SimulationView, SimulationFailure>,
): Promise<IntentSnapshot> {
  return simulation.ok
    ? advanceIntent(advance, assessed, {
        trigger: { type: "simulation_matched" },
        fields: { simulation: simulationDocument.encode(simulation.value) },
      })
    : advanceIntent(advance, assessed, {
        trigger: { type: "simulation_failed", reason: simulation.error },
      });
}

/**
 * Runs a send, revoke or bridge from its policy to its card (spec 6, section 5): the policy step,
 * then its quote and simulation, then the auto test, which leaves each to the owner's tap, so its
 * card opens for 10 minutes. A step that ends the intent ends the run there.
 */
export async function runToCard(
  advance: AdvanceParts,
  steps: {
    readonly judge: () => Promise<{
      readonly snapshot: IntentSnapshot;
      readonly pass?: PolicyPass;
    }>;
    readonly simulate: (checked: IntentSnapshot, pass: PolicyPass) => Promise<IntentSnapshot>;
    readonly wallet: WalletFacts;
    readonly isLocked: () => boolean;
  },
): Promise<IntentSnapshot> {
  const judged = await steps.judge();
  if (judged.pass === undefined) {
    return judged.snapshot;
  }
  const simulated = await steps.simulate(judged.snapshot, judged.pass);
  if (simulated.record.state !== "simulated") {
    return simulated;
  }
  const settings: AgentSettings = simulated.settings;
  const trigger = authorizationCheckOf({
    settings,
    pass: judged.pass,
    wallet: steps.wallet,
    isLocked: steps.isLocked(),
    hasUnlistedSpender: false,
  });
  return advanceIntent(advance, simulated, { trigger });
}
