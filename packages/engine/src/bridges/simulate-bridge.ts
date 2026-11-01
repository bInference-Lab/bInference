import { type TxDraft, type TxSimulator } from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import type { SimulationView } from "@binference/protocol";
import type { BridgeIntentQuote } from "../intents/bridge-quote.js";
import type { SimulationFailure } from "../intents/intent-reason.js";
import { checkEffects, simulationFailureOf } from "../simulation/check-effects.js";
import type { ResolvedBridge } from "./resolve-bridge.js";

/**
 * The simulate step of a bridge (spec 6, section 3): its steps run unsent on the source chain's
 * latest state. They pass when exactly the amount sent leaves the wallet, nothing arrives in it,
 * and it sets no allowance but its plan's approval of the amount sent: the delivery happens on
 * another chain, which no simulation reaches. A step that reverts is `simulation_reverted`, any
 * other difference `effects_differ`.
 */
export async function simulateBridge(
  parts: { readonly simulator: TxSimulator; readonly nowMs: () => number },
  planned: {
    readonly bridge: ResolvedBridge;
    readonly steps: readonly TxDraft[];
    readonly quote: BridgeIntentQuote;
  },
  signal: AbortSignal,
): Promise<Result<SimulationView, SimulationFailure>> {
  const { bridge, steps, quote } = planned;
  const { family } = bridge.chain;
  const approvals = steps.flatMap((step) => {
    const call = family.readDraft(step);
    return call.ok && call.value.approval !== undefined ? [call.value.approval] : [];
  });
  const simulated = await parts.simulator.simulate(steps, { signal });
  if (simulated.length !== steps.length) {
    return err("effects_differ");
  }
  const bounds = {
    wallet: bridge.account,
    amountIn: bridge.amount,
    minOut: { asset: quote.minOut.asset, base: 0n },
    approvals,
    family,
  };
  const checked = checkEffects(simulated, bounds);
  return checked.ok
    ? ok({ spent: [bridge.amount], received: [], simulatedAt: parts.nowMs() })
    : err(simulationFailureOf(checked.error));
}
