import { accountRefParts, type TokenApproval } from "@binference/chain";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { IntentMove } from "../intents/intent-change-of.js";
import { planDocument, simulationDocument } from "../intents/intent-documents.schema.js";
import type { PinFailure } from "../intents/intent-reason.js";
import type { IntentTrigger } from "../intents/intent-trigger.js";
import { createIntentStateMachine } from "../intents/state-machine.js";
import { type TokenLaunchQuote, tokenLaunchQuoteDocument } from "../intents/token-launch-quote.js";
import { simulationFailureOf } from "../simulation/check-effects.js";
import { checkLaunchEffects } from "../simulation/check-launch-effects.js";
import { advanceIntent } from "./advance-intent.js";
import { isLaunchStale, pinWaitOf, toldIfEnded } from "./launch-ending.js";
import { cardOnlyAuthorization } from "./open-card-unchecked.js";
import type { LaunchPathOptions } from "./resolve-launch.js";

/** One launch the pin follow moves: its ports, the run's signal and whether it is the repair. */
interface PinRun {
  readonly options: LaunchPathOptions;
  readonly signal: AbortSignal;
  readonly isRepair?: boolean;
}

/** How a launch is followed: by the timer, or by the startup's repair. */
export interface PinFollow {
  readonly signal: AbortSignal;
  /**
   * The startup's repair, which no proposal runs alongside: a launch in `checked` ends at once,
   * since the stop cut its upload or build short (decision 0237).
   */
  readonly isRepair?: boolean;
}

async function advance(
  run: PinRun,
  snapshot: IntentSnapshot,
  move: { readonly trigger: IntentTrigger } & Pick<IntentMove, "fields">,
): Promise<IntentSnapshot> {
  const machine = createIntentStateMachine({ clock: run.options.clock });
  return advanceIntent({ stored: run.options.stored, machine, signal: run.signal }, snapshot, move);
}

// The launch ends with its reason, and the owner hears which launch stopped and why.
async function endOnPin(
  run: PinRun,
  snapshot: IntentSnapshot,
  reason: PinFailure,
): Promise<IntentSnapshot> {
  const ended = await advance(run, snapshot, { trigger: { type: "pin_failed", reason } });
  return toldIfEnded(run.options, ended);
}

// A launch a stop left in `checked` ends `upload_lost` with a notice: at the startup's repair at
// once, and else once its pin wait has passed since its check, long after any proposal ended.
async function followChecked(run: PinRun, snapshot: IntentSnapshot): Promise<IntentSnapshot> {
  const lostAtMs = snapshot.record.changedAtMs + pinWaitOf(run.options);
  if (run.isRepair !== true && run.options.clock.now() < lostAtMs) {
    return snapshot;
  }
  const trigger = { type: "quote_failed", reason: "upload_lost" } as const;
  return toldIfEnded(run.options, await advance(run, snapshot, { trigger }));
}

// A launch a stop left between its pin and its card goes on to its card, unless it is too old to
// show: then it is cancelled, and the owner hears why (decision 0237).
async function followPinned(
  run: PinRun,
  snapshot: IntentSnapshot,
  quote: TokenLaunchQuote,
): Promise<IntentSnapshot> {
  if (!isLaunchStale(snapshot, quote, run.options.clock.now())) {
    return toldIfEnded(run.options, await toCard(run, snapshot, quote));
  }
  const trigger = {
    type: "cancel_requested",
    cause: "engine_stopping",
    hasSignedStep: false,
  } as const;
  return toldIfEnded(run.options, await advance(run, snapshot, { trigger }));
}

// The approvals the plan's steps grant, as the chain's family reads them.
function approvalsOf(run: PinRun, snapshot: IntentSnapshot): readonly TokenApproval[] {
  const steps = snapshot.record.plan === undefined ? [] : planDocument.decode(snapshot.record.plan);
  return steps.flatMap((step) => {
    const chain = run.options.chains.get(step.chain);
    const call = chain.ok ? chain.value.family.readDraft(step) : undefined;
    return call?.ok === true && call.value.approval !== undefined ? [call.value.approval] : [];
  });
}

// The steps run unsent on the latest state, on the launch wallet's own balances, and must do
// what the launch says and nothing else (decision 0234).
async function simulate(
  run: PinRun,
  snapshot: IntentSnapshot,
  quote: TokenLaunchQuote,
): Promise<IntentSnapshot> {
  const { options, signal } = run;
  const steps = snapshot.record.plan === undefined ? [] : planDocument.decode(snapshot.record.plan);
  const [first] = steps;
  const chain =
    first === undefined ? undefined : options.chains.get(accountRefParts(first.from).chain);
  if (first === undefined || chain?.ok !== true) {
    return advance(run, snapshot, {
      trigger: { type: "simulation_failed", reason: "effects_differ" },
    });
  }
  const simulated = await options.launch.simulator.simulate(steps, { signal });
  const { firstBuy } = quote;
  const effects = checkLaunchEffects(simulated, {
    wallet: first.from,
    nativeAsset: quote.fee.asset,
    fee: quote.fee,
    token: quote.token,
    approvals: approvalsOf(run, snapshot),
    family: chain.value.family,
    ...(firstBuy === undefined ? {} : { firstBuy: firstBuy.spend, minOutBase: firstBuy.minOut }),
  });
  if (!effects.ok) {
    const reason = simulationFailureOf(effects.error);
    return advance(run, snapshot, { trigger: { type: "simulation_failed", reason } });
  }
  const view = { ...effects.value, simulatedAt: options.clock.now() };
  const fields = { simulation: simulationDocument.encode(view) };
  return advance(run, snapshot, { trigger: { type: "simulation_matched" }, fields });
}

// A pinned launch is simulated and opens its card: its kind never passes the auto test. A launch
// a stop left part way on, in `assessed` or `simulated`, goes on from where it is.
async function toCard(
  run: PinRun,
  snapshot: IntentSnapshot,
  quote: TokenLaunchQuote,
): Promise<IntentSnapshot> {
  const simulated =
    snapshot.record.state === "assessed" ? await simulate(run, snapshot, quote) : snapshot;
  if (simulated.record.state !== "simulated") {
    return simulated;
  }
  const trigger = cardOnlyAuthorization(simulated.settings, { isLocked: run.options.isLocked() });
  return advance(run, simulated, { trigger });
}

/** The states a launch is followed in: its upload, its pin wait, and on from its pin to its card. */
export const followedStates = ["checked", "quoted", "assessed", "simulated"] as const;

/**
 * Asks a launch waiting in `quoted` whether its launchpad reported the pin (decision 0234): a
 * reported pin moves it on to its simulation and its card; a failed one, or the end of the pin
 * wait, ends it with `pin_failed` or `pin_timeout`; no report yet leaves it waiting. A launch a
 * stop left in `checked` ends `upload_lost`, and one it left in `assessed` or `simulated` goes on
 * to its card unless it is too old to show (decision 0237). The owner hears of every launch that
 * ends once its upload began. Any other intent is answered as it is.
 */
export async function followLaunchPin(
  options: LaunchPathOptions,
  snapshot: IntentSnapshot,
  follow: PinFollow,
): Promise<IntentSnapshot> {
  const { record } = snapshot;
  const isFollowed = followedStates.some((state) => state === record.state);
  if (record.kind !== "launchToken" || !isFollowed) {
    return snapshot;
  }
  const run = { options, ...follow };
  if (record.state === "checked") {
    return followChecked(run, snapshot);
  }
  if (record.quote === undefined) {
    return snapshot;
  }
  const quote = tokenLaunchQuoteDocument.decode(record.quote);
  if (record.state !== "quoted") {
    return followPinned(run, snapshot, quote);
  }
  if (options.clock.now() >= quote.pinWaitUntilMs) {
    return endOnPin(run, snapshot, "pin_timeout");
  }
  const status = await options.launch.host.pinStatus(quote.venue, quote.pin, {
    signal: follow.signal,
  });
  if (status === "failed") {
    return endOnPin(run, snapshot, "pin_failed");
  }
  if (status !== "pinned") {
    return snapshot;
  }
  const pinned = await advance(run, snapshot, { trigger: { type: "pin_reported" } });
  return pinned.record.state === "assessed" ? followPinned(run, pinned, quote) : pinned;
}
