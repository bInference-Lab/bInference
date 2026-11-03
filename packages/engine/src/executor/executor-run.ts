import type { Logger } from "@binference/core";
import type { CapGate } from "../confirmations/cap-gate.js";
import type { IdentityRecord } from "../identity/identity-record.js";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import type { ReasonNamed, SettledTrade } from "../intents/event-cause.schema.js";
import type { IntentTrigger } from "../intents/intent-trigger.js";
import type { IntentStateMachine } from "../intents/state-machine.js";
import type { OrderStore } from "../orders/ports.js";
import type { PolicyCheck } from "../policy/check-policy.js";
import type { IntentStore } from "../ports.js";
import type { Positions } from "../positions/create-positions.js";
import type { ExecutorLimits, ExecutorOptions } from "./executor-options.js";
import type { HeldWallets } from "./held-wallets.js";
import type { IntentPlan } from "./intent-plan.js";

/** The executor's options with what it builds from them once. */
export interface ExecutorParts extends ExecutorOptions {
  /** The intent store, which the queue check reads confirmations from. */
  readonly intents: IntentStore;
  /** The auto orders, whose live fills the executor signs under their grants and records. */
  readonly orders: OrderStore;
  /** Whether live order fills may sign (decision 0211). */
  readonly liveFills: boolean;
  /** What the agent used of the rolling cap, which a fill's skip for the cap tells. */
  readonly spent: CapGate["spent"];
  readonly stored: StoredIntents;
  readonly machine: IntentStateMachine;
  readonly policy: PolicyCheck;
  /** The positions over `positions`, which value each trade reconciliation records. */
  readonly valuedPositions: Positions;
  readonly limits: ExecutorLimits;
  readonly log: Logger;
  /** The wallets the watches hold now; a watch adds its wallet and takes it out as it ends. */
  readonly held: HeldWallets;
}

/** One intent's execution: its parts, its plan, and the signals that stop it. */
export interface ExecutionRun {
  readonly parts: ExecutorParts;
  readonly plan: IntentPlan;
  /** Aborts every call of the run, a signature or a send under way too. */
  readonly signal: AbortSignal;
  /**
   * Aborts once the engine begins to stop, and with `signal`: every wait ends and no step starts,
   * while a signature or a send under way runs on until `signal` aborts.
   */
  readonly stopping: AbortSignal;
}

/** A trigger with the trade the move to `reconciled` records. */
export interface SettlingMove {
  readonly trigger: IntentTrigger<"fills_reconciled">;
  readonly settled: SettledTrade;
  /** What the receipt names beside the trade, such as an unstake's ready time. */
  readonly named?: ReasonNamed;
}

/**
 * A registration's move to `reconciled` with the identity its registry read back, stored in the
 * move's own write, and the id its receipt names (decision 0335).
 */
export interface RegisteringMove {
  readonly trigger: IntentTrigger<"fills_reconciled">;
  readonly identity: IdentityRecord;
  readonly named: ReasonNamed;
}

/** A refusal that ends the intent, with what its words name (decision 0327). */
export interface NamingMove {
  readonly trigger: IntentTrigger<"stake_refused">;
  readonly named: ReasonNamed;
}

/**
 * Applies a trigger to the intent as last read and stores the move under that read's version,
 * with the settled trade when it brings one. A refusal by the state machine, or a write another
 * writer beat, is logged and gives `undefined`: the run stops where the intent is.
 */
export async function moveIntent(
  run: Pick<ExecutionRun, "parts" | "signal">,
  snapshot: IntentSnapshot,
  change: IntentTrigger | SettlingMove | NamingMove | RegisteringMove,
): Promise<IntentSnapshot | undefined> {
  const { parts, signal } = run;
  const intentId = snapshot.record.id;
  const { trigger, ...settling } = "trigger" in change ? change : { trigger: change };
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

/** Waits about one block of the run's chain, or rejects once the engine begins to stop. */
export async function nextBlock(run: ExecutionRun): Promise<void> {
  await run.parts.clock.sleep(run.plan.chain.definition.blockTimeMs, run.stopping);
}
