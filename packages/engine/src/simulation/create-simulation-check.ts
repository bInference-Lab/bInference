import {
  type AccountRef,
  type ChainFamily,
  type ChainRegistry,
  isSameAccount,
  type SimulationOptions,
  type TokenApproval,
  type TxDraft,
  type TxSimulator,
} from "@binference/chain";
import { type Clock, err, ok, type Result } from "@binference/core";
import type { SimulationView } from "@binference/protocol";
import type { BuiltQuote } from "../confirmations/stored-intent.js";
import type { SimulationFailure } from "../intents/intent-reason.js";
import type { Simulator } from "../ports.js";
import { checkEffects, simulationFailureOf } from "./check-effects.js";

/** What the simulation check runs on. */
export interface SimulationCheckOptions {
  /** Runs the steps unsent on the latest state of their chain, any chain of `chains`. */
  readonly simulator: TxSimulator;
  readonly chains: ChainRegistry;
  readonly clock: Clock;
}

/** What the check reads from a plan's steps before it runs them. */
interface ReadPlan {
  readonly wallet: AccountRef;
  readonly family: ChainFamily;
  readonly approvals: readonly TokenApproval[];
}

// The first step's sender is the wallet. Every step comes from it on its chain, and its family
// reads each one: the approval steps name the only allowances the wallet may set.
function readPlan(steps: readonly TxDraft[], chains: ChainRegistry): ReadPlan | undefined {
  const [first] = steps;
  const chain = first === undefined ? undefined : chains.get(first.chain);
  if (first === undefined || chain?.ok !== true) {
    return undefined;
  }
  const { family } = chain.value;
  const calls = steps.flatMap((step) => {
    const call = family.readDraft(step);
    const isOwn = step.chain === first.chain && isSameAccount(step.from, first.from, family);
    return call.ok && isOwn ? [call.value] : [];
  });
  if (calls.length !== steps.length) {
    return undefined;
  }
  const approvals = calls.flatMap((call) => (call.approval === undefined ? [] : [call.approval]));
  return { wallet: first.from, family, approvals };
}

async function check(
  built: BuiltQuote,
  options: SimulationCheckOptions,
  call: SimulationOptions,
): Promise<Result<SimulationView, SimulationFailure>> {
  call.signal.throwIfAborted();
  const plan = readPlan(built.steps, options.chains);
  if (plan === undefined) {
    return err("effects_differ");
  }
  const steps = await options.simulator.simulate(built.steps, call);
  if (steps.length !== built.steps.length) {
    return err("effects_differ");
  }
  const { amountIn, minOut } = built.quote;
  const checked = checkEffects(steps, { ...plan, amountIn, minOut });
  if (!checked.ok) {
    return err(simulationFailureOf(checked.error));
  }
  const { spent, received } = checked.value;
  return ok({ spent: [spent], received: [received], simulatedAt: options.clock.now() });
}

/**
 * Creates the simulate step of the money path as the engine's `Simulator`: it runs a quote's
 * steps unsent through the chain's `TxSimulator`, with the balances it is given, and holds what
 * they do to the wallet to the quote's terms (see {@link checkEffects}). A plan it cannot read,
 * with no step, a step from another sender or a draft the family cannot read, is `effects_differ`
 * and runs nothing. When the chain cannot simulate, it rejects and the intent stays where it is.
 */
export function createSimulationCheck(options: SimulationCheckOptions): Simulator {
  return {
    simulate: async (_intent, built, call) => check(built, options, call),
  };
}
