import type { AccountRef } from "@binference/chain";
import { BinferenceError, type Id } from "@binference/core";
import { createStoredIntents } from "../intents/create-stored-intents.js";
import { createIntentStateMachine } from "../intents/state-machine.js";
import { createPolicyCheck } from "../policy/check-policy.js";
import type { Executor } from "../ports.js";
import { createPositions } from "../positions/create-positions.js";
import { executeInSlot } from "./execute-in-slot.js";
import { defaultExecutorLimits, type ExecutorOptions } from "./executor-options.js";
import type { ExecutionRun, ExecutorParts } from "./executor-run.js";
import { type IntentPlan, intentPlanOf } from "./intent-plan.js";
import {
  liveIntentsIn,
  recoverIntent,
  type Unsettled,
  unsettledIntents,
} from "./recover-intents.js";
import { settleIncluded } from "./settle-included.js";

/** The executor of a running engine, which the engine's startup recovers and shutdown closes. */
export interface RunningExecutor extends Executor {
  /**
   * Recovers every live intent a stop left between `executing` and `reconciled` (spec 6, section
   * 7): each stored step is looked up by hash and nonce and goes on from what the chain shows,
   * and nothing is ever signed again. It resolves with how many intents it took once each holds
   * its place: an intent whose steps' fates are still open waits on its wallet's queue, ahead of
   * any intent taken later, so call it at startup before anything is taken. The recoveries run on
   * like taken intents, and `close` stops them.
   */
  recover(options: { readonly signal: AbortSignal }): Promise<number>;
  /**
   * Takes every confirmed live intent no queue took yet, as an earlier run left them, the least
   * recently changed first, and resolves with how many it went through. A locked engine holds them
   * until it holds the agent key (decision 0103), so call it after `recover`, once unlocked. Each
   * goes through `take`, which leaves one whose confirmation expired as it is.
   */
  takeConfirmed(options: { readonly signal: AbortSignal }): Promise<number>;
  /**
   * Stops the executor in the engine's shutdown order: it takes nothing more, every wait ends and
   * no step starts, while a signature or a send under way runs to its end, so a signed step is
   * stored and sent before the engine stops. Once `signal` aborts, those stop too. Resolves once
   * every work has ended; a second call waits for the same works.
   */
  close(options: { readonly signal: AbortSignal }): Promise<void>;
}

/** A live intent the executor runs, and what it does with it once it runs. */
interface Work {
  readonly intent: Id<"int">;
  readonly plan: IntentPlan;
  readonly go: (run: ExecutionRun) => Promise<void>;
}

/** A confirmed intent the executor can take: its plan and the wallet's account on its chain. */
interface Taken {
  readonly intent: Id<"int">;
  readonly plan: IntentPlan;
  readonly account: AccountRef;
}

function partsOf(options: ExecutorOptions): ExecutorParts {
  const { stores, ids, publish, clock } = options;
  return {
    ...options,
    intents: stores.intents,
    stored: createStoredIntents({ intents: stores.intents, agents: stores.agents, ids, publish }),
    machine: createIntentStateMachine({ clock }),
    policy: createPolicyCheck({ prices: options.prices, clock }),
    valuedPositions: createPositions({ store: options.positions, prices: options.prices }),
    limits: { ...defaultExecutorLimits, ...options.limits },
    log: options.logger.child("executor"),
  };
}

// What the executor needs before it queues an intent; anything missing leaves it `confirmed`.
async function workOf(
  parts: ExecutorParts,
  intent: Id<"int">,
  signal: AbortSignal,
): Promise<Taken | string> {
  const snapshot = await parts.stored.snapshot(intent, { signal });
  if (snapshot === undefined || snapshot.record.state !== "confirmed" || snapshot.record.isPaper) {
    return "not_confirmed";
  }
  const planned = intentPlanOf(snapshot.record, parts);
  if ("problem" in planned) {
    return planned.problem;
  }
  const { plan } = planned;
  const account = await parts.custody.account(snapshot.record.walletId, plan.chain.ref, { signal });
  if (!account.ok) {
    return account.error;
  }
  const isOwn = plan.steps.every((step) => step.from === account.value);
  return isOwn ? { intent, plan, account: account.value } : "other_sender";
}

// A confirmed intent on its wallet's queue, then off it until it reconciles.
function takenWork(taken: Taken): Work {
  return {
    ...taken,
    async go(run) {
      // A work still waiting for its wallet when the engine stops leaves the queue unrun.
      const included = await run.parts.queue.run(
        taken.account,
        async (slot) => executeInSlot(run, slot, taken.intent),
        { signal: run.stopping },
      );
      if (included !== undefined) {
        await settleIncluded(run, included);
      }
    },
  };
}

function recoveryWork(unsettled: Unsettled): Work {
  const { snapshot, plan } = unsettled;
  return { intent: snapshot.record.id, plan, go: async (run) => recoverIntent(run, unsettled) };
}

/** The executor's two stops: the engine beginning to stop, then every call cut. */
interface Stops {
  readonly stopping: AbortController;
  readonly lifetime: AbortController;
}

// A work's fault is logged with its code; one the engine's stop caused is no error. The work
// starts at once, so a work that queues takes its place in the queue as it is tracked.
async function execute(parts: ExecutorParts, work: Work, stops: Stops): Promise<void> {
  const signal = stops.lifetime.signal;
  const stopping = AbortSignal.any([stops.stopping.signal, signal]);
  const run = { parts, plan: work.plan, signal, stopping };
  try {
    await work.go(run);
  } catch (error) {
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    const level = stopping.aborted ? "info" : "error";
    parts.log[level]("executor.failed", { intentId: work.intent, errorCode });
  }
}

// The engine begins to stop at once; the calls under way stop too once `signal` aborts.
async function stopAll(
  stops: Stops,
  running: ReadonlySet<Promise<void>>,
  signal: AbortSignal,
): Promise<void> {
  const reason = new BinferenceError({
    code: "engine.stopping",
    message: "The engine is stopping.",
  });
  stops.stopping.abort(reason);
  const cut = (): void => stops.lifetime.abort(reason);
  if (signal.aborted) {
    cut();
  }
  signal.addEventListener("abort", cut, { once: true });
  // Nothing joins the works once the executor stops, so these are the last ones.
  await Promise.allSettled(running);
  signal.removeEventListener("abort", cut);
}

// One at a time, so each takes its place in its wallet's queue in the order it waited.
async function takeEachConfirmed(
  parts: ExecutorParts,
  take: RunningExecutor["take"],
  signal: AbortSignal,
): Promise<number> {
  const confirmed = await liveIntentsIn(parts, ["confirmed"], { signal });
  await confirmed.reduce<Promise<void>>(
    async (earlier, record) => earlier.then(async () => take(record.id, { signal })),
    Promise.resolve(),
  );
  return confirmed.length;
}

function closed(details: Readonly<Record<string, string>>): BinferenceError {
  return new BinferenceError({
    code: "engine.executor_closed",
    message: "The executor has stopped and takes no more intents.",
    details,
  });
}

/**
 * Creates the executor (ARCHITECTURE.md section 7, steps 8 and 9). `take` reads a confirmed live
 * intent, its plan and its wallet's account, queues its work on the wallet's queue, and resolves;
 * the work runs on until the intent reconciles, the run stops, or a step is handed over. A work
 * that fails is logged with its fault's code; an intent the executor cannot run stays as it was,
 * and the reason is logged. `recover` takes up what a stop left unsettled. `close` lets a
 * signature or a send under way end and stops the rest: what was signed is stored, so recovery
 * goes on from the store.
 */
export function createExecutor(options: ExecutorOptions): RunningExecutor {
  const parts = partsOf(options);
  const stops: Stops = { stopping: new AbortController(), lifetime: new AbortController() };
  const running = new Set<Promise<void>>();
  const track = (work: Work): void => {
    const finished = execute(parts, work, stops);
    running.add(finished);
    void finished.finally(() => running.delete(finished));
  };
  const take: RunningExecutor["take"] = async (intent, { signal }) => {
    signal.throwIfAborted();
    if (stops.stopping.signal.aborted) {
      throw closed({ intent });
    }
    const taken = await workOf(parts, intent, signal);
    if (typeof taken === "string") {
      parts.log.warn("executor.not_taken", { intentId: intent, errorCode: taken });
      return;
    }
    track(takenWork(taken));
  };
  return {
    take,
    takeConfirmed: async ({ signal }) => takeEachConfirmed(parts, take, signal),
    async recover({ signal }) {
      signal.throwIfAborted();
      if (stops.stopping.signal.aborted) {
        throw closed({});
      }
      const unsettled = await unsettledIntents(parts, signal);
      unsettled.forEach((found) => {
        parts.log.info("executor.recovering", { intentId: found.snapshot.record.id });
        track(recoveryWork(found));
      });
      return unsettled.length;
    },
    close: async ({ signal }) => stopAll(stops, running, signal),
  };
}
