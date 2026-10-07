import type { AccountRef } from "@binference/chain";
import { BinferenceError, type Id } from "@binference/core";
import { createStoredIntents } from "../intents/create-stored-intents.js";
import { createIntentStateMachine } from "../intents/state-machine.js";
import { createPolicyCheck } from "../policy/check-policy.js";
import type { Executor } from "../ports.js";
import { executeInSlot } from "./execute-in-slot.js";
import { defaultExecutorLimits, type ExecutorOptions } from "./executor-options.js";
import type { ExecutorParts } from "./executor-run.js";
import { type IntentPlan, intentPlanOf } from "./intent-plan.js";
import { watchFinality } from "./watch-finality.js";

/** The executor of a running engine, which the engine's shutdown closes. */
export interface RunningExecutor extends Executor {
  /** Stops every running work's waits and sends, and resolves once each has ended. */
  close(): Promise<void>;
}

/** A confirmed intent the executor can run: its plan and the wallet's account on its chain. */
interface Work {
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
    limits: { ...defaultExecutorLimits, ...options.limits },
    log: options.logger.child("executor"),
  };
}

// What the executor needs before it queues an intent; anything missing leaves it `confirmed`.
async function workOf(
  parts: ExecutorParts,
  intent: Id<"int">,
  signal: AbortSignal,
): Promise<Work | string> {
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

// A work's fault is logged with its code; one the engine's stop caused is no error.
async function execute(parts: ExecutorParts, work: Work, signal: AbortSignal): Promise<void> {
  const run = { parts, plan: work.plan, signal };
  try {
    const included = await parts.queue.run(
      work.account,
      async (slot) => executeInSlot(run, slot, work.intent),
      { signal },
    );
    if (included !== undefined) {
      await watchFinality(run, included.included, included.steps);
    }
  } catch (error) {
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    const level = signal.aborted ? "info" : "error";
    parts.log[level]("executor.failed", { intentId: work.intent, errorCode });
  }
}

/**
 * Creates the executor (ARCHITECTURE.md section 7, step 8). `take` reads a confirmed live intent,
 * its plan and its wallet's account, queues its work on the wallet's queue, and resolves; the work
 * runs on until every step is final, the run stops, or a step is handed over. A work that fails
 * is logged with its fault's code; an intent the executor cannot run stays as it was, and the
 * reason is logged. `close` stops every work at once: what was signed is stored, so recovery goes
 * on from the store.
 */
export function createExecutor(options: ExecutorOptions): RunningExecutor {
  const parts = partsOf(options);
  const lifetime = new AbortController();
  const running = new Set<Promise<void>>();
  const track = (work: Work): void => {
    const finished = execute(parts, work, lifetime.signal);
    running.add(finished);
    void finished.finally(() => running.delete(finished));
  };
  return {
    async take(intent, { signal }) {
      signal.throwIfAborted();
      if (lifetime.signal.aborted) {
        throw new BinferenceError({
          code: "engine.executor_closed",
          message: "The executor has stopped and takes no more intents.",
          details: { intent },
        });
      }
      const work = await workOf(parts, intent, signal);
      if (typeof work === "string") {
        parts.log.warn("executor.not_taken", { intentId: intent, errorCode: work });
        return;
      }
      track(work);
    },
    async close() {
      lifetime.abort(
        new BinferenceError({ code: "engine.stopping", message: "The engine is stopping." }),
      );
      await Promise.allSettled(running);
    },
  };
}
