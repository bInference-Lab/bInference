import type { Result } from "@binference/core";
import type { LimitsValues } from "../agents/limits-record.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { riskDocument, simulationDocument } from "../intents/intent-documents.schema.js";
import type { SimulationFailure } from "../intents/intent-reason.js";
import type { RiskCheck } from "../ports.js";
import { type SimulatedSteps, simulationViewOf } from "../simulation/simulated-steps.js";
import type { VenueTrade } from "../venues/venue-host.js";
import { type AdvanceParts, advanceIntent } from "./advance-intent.js";
import type { PlannedSwap } from "./plan-swap.js";

/** What the risk step weighs: the trade the route runs, with the agent's limits. */
export interface RiskStepParts extends AdvanceParts {
  readonly risk: RiskCheck;
  readonly trade: VenueTrade;
  readonly limits: LimitsValues;
}

/**
 * Step 4 of the money path: weighs the token the chosen route buys at the quote it was built
 * from, against the agent's tax and liquidity limits, and stores its view whether it passes or
 * refuses.
 */
export async function assessRisk(
  parts: RiskStepParts,
  snapshot: IntentSnapshot,
  planned: PlannedSwap,
): Promise<IntentSnapshot> {
  const { plan } = planned;
  const quoted = {
    trade: { ...parts.trade, venue: plan.venue },
    quote: plan.quote,
    quotedAtMs: plan.terms.quotedAtMs,
  };
  const { taxBps, liquidityFloorUsdMicros } = parts.limits;
  const limits = { maxTaxBps: taxBps, liquidityFloorUsdMicros };
  const assessment = await parts.risk.assess({ quoted, limits }, { signal: parts.signal });
  const fields = { risk: riskDocument.encode(assessment.view) };
  const trigger =
    assessment.refusal === undefined
      ? ({ type: "risk_passed" } as const)
      : ({ type: "risk_refused", reason: assessment.refusal } as const);
  return advanceIntent(parts, snapshot, { trigger, fields });
}

/**
 * Step 5 of the money path: the chosen route was simulated when the best quote weighed it; this
 * step stores that run, or ends the intent with its failure.
 */
export async function storeSimulation(
  parts: AdvanceParts,
  snapshot: IntentSnapshot,
  simulation: Result<SimulatedSteps, SimulationFailure>,
): Promise<IntentSnapshot> {
  if (!simulation.ok) {
    return advanceIntent(parts, snapshot, {
      trigger: { type: "simulation_failed", reason: simulation.error },
    });
  }
  const fields = { simulation: simulationDocument.encode(simulationViewOf(simulation.value)) };
  return advanceIntent(parts, snapshot, { trigger: { type: "simulation_matched" }, fields });
}
