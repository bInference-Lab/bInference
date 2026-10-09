import type { Logger } from "@binference/core";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import type { SettledTrade } from "../intents/event-cause.schema.js";
import type { IntentTrigger } from "../intents/intent-trigger.js";
import type { IntentStateMachine } from "../intents/state-machine.js";
import type { PolicyCheck } from "../policy/check-policy.js";
import type { IntentStore } from "../ports.js";
import type { Positions } from "../positions/create-positions.js";
import type { ExecutorLimits, ExecutorOptions } from "./executor-options.js";
import type { IntentPlan } from "./intent-plan.js";

/** The executor's options with what it builds from them once. */
export interface ExecutorParts extends ExecutorOptions {
  /** The intent store, which the queue check reads confirmations from. */
  readonly intents: IntentStore;
  readonly stored: StoredIntents;
  readonly machine: IntentStateMachine;
  readonly policy: PolicyCheck;
  /** The positions over `positions`, which value each trade reconciliation records. */
  readonly valuedPositions: Positions;
  readonly limits: ExecutorLimits;
  readonly log: Logger;
}

/** One intent's execution: its parts, its plan, and the signal that stops it. */
export interface ExecutionRun {
  readonly parts: ExecutorParts;
  readonly plan: IntentPlan;
  readonly signal: AbortSignal;
}

/** A trigger with the trade the move to `reconciled` records. */
export interface SettlingMove {
  readonly trigger: IntentTrigger<"fills_reconciled">;
  readonly settled: SettledTrade;
}

/**
 * Applies a trigger to the intent as last read and stores the move under that read's version,
 * with the settled trade when it brings one. A refusal by the state machine, or a write another
 * writer beat, is logged and gives `undefined`: the run stops where the intent is.
 */
export async function moveIntent(
  run: ExecutionRun,
  snapshot: IntentSnapshot,
  change: IntentTrigger | SettlingMove,
): Promise<IntentSnapshot | undefined> {
  const { parts, signal } = run;
  const intentId = snapshot.record.id;
  const { trigger, ...settling } = "settled" in change ? change : { trigger: change };
  const step = parts.machine.apply(snapshot.stored.status, trigger);
  if (!step.ok) {
    parts.log.warn("executor.move_refused", { intentId, errorCode: step.error });
    return undefined;
  }
  const move = {
    intent: intentId,
    version: snapshot.stored.version,
    step: step.value,
    by: "engine",
    ...settling,
  };
  const moved = await parts.stored.move(move, { signal });
  if (!moved.ok) {
    parts.log.warn("executor.move_stale", { intentId, errorCode: trigger.type });
    return undefined;
  }
  return moved.value;
}

/**
 * Runs a chain read; a read that fails for any reason but the run's stop is logged and gives
 * `undefined`, so the watch tries again on the next block.
 */
export async function readSafely<T>(
  run: ExecutionRun,
  read: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    run.signal.throwIfAborted();
    const errorCode = error instanceof Error && "code" in error ? String(error.code) : "unexpected";
    run.parts.log.warn("executor.read_failed", { chain: run.plan.chain.ref, errorCode });
    return undefined;
  }
}

/** Waits about one block of the run's chain, or rejects once the run stops. */
export async function nextBlock(run: ExecutionRun): Promise<void> {
  await run.parts.clock.sleep(run.plan.chain.definition.blockTimeMs, run.signal);
}
