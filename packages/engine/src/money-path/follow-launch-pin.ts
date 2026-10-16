import { accountRefParts, type TokenApproval } from "@binference/chain";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { IntentMove } from "../intents/intent-change-of.js";
import {
  planDocument,
  requestDocument,
  simulationDocument,
} from "../intents/intent-documents.schema.js";
import type { PinFailure } from "../intents/intent-reason.js";
import type { IntentTrigger } from "../intents/intent-trigger.js";
import { createIntentStateMachine } from "../intents/state-machine.js";
import { type TokenLaunchQuote, tokenLaunchQuoteDocument } from "../intents/token-launch-quote.js";
import { noticePush } from "../pushes/notice-push.js";
import { simulationFailureOf } from "../simulation/check-effects.js";
import { checkLaunchEffects } from "../simulation/check-launch-effects.js";
import { advanceIntent } from "./advance-intent.js";
import { cardOnlyAuthorization } from "./open-card-unchecked.js";
import type { LaunchPathOptions } from "./resolve-launch.js";

// The owner's notice of a launch that stopped on its pin (decision 0234).
const launchStoppedNoticeKey = "notice.launchStopped";

/** One launch the pin follow moves: its ports, the run's signal and the stored launch. */
interface PinRun {
  readonly options: LaunchPathOptions;
  readonly signal: AbortSignal;
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
  if (ended.record.state === "failed_check") {
    const request = requestDocument.decode(ended.record.request);
    const symbol = request.kind === "launchToken" ? request.symbol : "";
    const venue = request.kind === "launchToken" ? request.venue : "";
    const { id, agentId } = ended.record;
    const values = { symbol, venue, reason };
    run.options.launch.publish(
      noticePush({ key: launchStoppedNoticeKey, agent: agentId, intent: id, values }),
    );
  }
  return ended;
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

// The states a launch is followed in: waiting for its pin, and the two a stop can leave it in on
// its way from the pin to its card.
const followedStates = ["quoted", "assessed", "simulated"] as const;

/**
 * Asks a launch waiting in `quoted` whether its launchpad reported the pin (decision 0234): a
 * reported pin moves it on to its simulation and its card; a failed one, or the end of the pin
 * wait, ends it with `pin_failed` or `pin_timeout` and a notice to the owner; no report yet leaves
 * it waiting. A launch a stop left in `assessed` or `simulated` goes on to its card. Any other
 * intent is answered as it is.
 */
export async function followLaunchPin(
  options: LaunchPathOptions,
  snapshot: IntentSnapshot,
  signal: AbortSignal,
): Promise<IntentSnapshot> {
  const { record } = snapshot;
  const isFollowed = followedStates.some((state) => state === record.state);
  if (record.kind !== "launchToken" || !isFollowed || record.quote === undefined) {
    return snapshot;
  }
  const run = { options, signal };
  const quote = tokenLaunchQuoteDocument.decode(record.quote);
  if (record.state !== "quoted") {
    return toCard(run, snapshot, quote);
  }
  if (options.clock.now() >= quote.pinWaitUntilMs) {
    return endOnPin(run, snapshot, "pin_timeout");
  }
  const status = await options.launch.host.pinStatus(quote.venue, quote.pin, { signal });
  if (status === "failed") {
    return endOnPin(run, snapshot, "pin_failed");
  }
  if (status !== "pinned") {
    return snapshot;
  }
  const pinned = await advance(run, snapshot, { trigger: { type: "pin_reported" } });
  return pinned.record.state === "assessed" ? toCard(run, pinned, quote) : pinned;
}

// The launches a page reads at a time.
const pageSize = 50;

/**
 * Follows the pin of every live launch waiting in `quoted` (decision 0234), and moves on each
 * launch a stop left between its pin and its card: a timer of the composition root calls it every
 * 3 seconds. Answers how many it moved.
 */
export async function followLaunchPins(
  options: LaunchPathOptions,
  call: { readonly signal: AbortSignal },
): Promise<number> {
  const { signal } = call;
  const waiting = await options.stored.list(
    { states: [...followedStates], isPaper: false, limit: pageSize },
    { signal },
  );
  const launches = waiting.filter((record) => record.kind === "launchToken");
  return launches.reduce<Promise<number>>(async (counted, record) => {
    const count = await counted;
    const snapshot = await options.stored.snapshot(record.id, { signal });
    const moved =
      snapshot === undefined ? snapshot : await followLaunchPin(options, snapshot, signal);
    return moved !== undefined && moved.record.state !== record.state ? count + 1 : count;
  }, Promise.resolve(0));
}
