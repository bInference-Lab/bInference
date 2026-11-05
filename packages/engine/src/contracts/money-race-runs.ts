import assert from "node:assert/strict";
import type { AccountRef } from "@binference/chain";
import { BinferenceError, type Result } from "@binference/core";
import type { OrderStore } from "../orders/ports.js";
import type {
  AgentStore,
  IntentStore,
  LedgerStore,
  PositionStore,
  TransactionStore,
} from "../ports.js";
import type { PlantedPair } from "./order-fixtures.js";

/** One writer of an install's engine database: its money stores, bound to its own host. */
export interface MoneyWriter {
  readonly intents: IntentStore;
  readonly ledger: LedgerStore;
  readonly orders: OrderStore;
  readonly positions: PositionStore;
  readonly transactions: TransactionStore;
}

/**
 * Writers of one engine database that race, with an agent and its wallet, another agent, the
 * agent store and two accounts. Each writer runs its own writes in order; the writers run at once.
 */
export interface MoneyRaceSubject extends PlantedPair {
  readonly writers: readonly MoneyWriter[];
  readonly agents: AgentStore;
  readonly other: PlantedPair;
  readonly accounts: readonly [AccountRef, AccountRef];
  /**
   * How many writes the writers ran again after a conflict so far, on a database that retries:
   * where it is given, each race must meet at least one, or it proved nothing of the retries.
   */
  readonly retries?: () => number;
}

/** Makes a fresh database with its racing writers for each check. */
export interface MoneyRaceHarness {
  create(): Promise<MoneyRaceSubject>;
  /** How many plans the no-double-booking property samples; 10 by default. */
  readonly propertyRuns?: number;
}

/** A write that ran out of retries on a conflict: it wrote nothing, and its caller reads again. */
export const conflict = "conflict";

/** A write's own answer, or {@link conflict} for one that gave up on conflicts; any other fault fails. */
export async function settled<Output>(work: Promise<Output>): Promise<Output | typeof conflict> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof BinferenceError && error.code === "store.write_conflict") {
      return conflict;
    }
    throw error;
  }
}

/** A settled write's answer as one word: `ok`, its refusal, or {@link conflict}. */
export function answerOf<Value, Refusal extends string>(
  outcome: Result<Value, Refusal> | typeof conflict,
): Refusal | "ok" | typeof conflict {
  if (outcome === conflict) {
    return conflict;
  }
  return outcome.ok ? "ok" : outcome.error;
}

/** The first writer, which sets a race up and reads its outcome. */
export function firstOf(subject: MoneyRaceSubject): MoneyWriter {
  const [writer] = subject.writers;
  assert.ok(writer !== undefined, "A race needs a writer.");
  return writer;
}

/**
 * Runs `work` on every writer at once, each writer's own calls in order. On a subject that counts
 * retries, the race must have run a write again after a conflict.
 */
export async function race<Output>(
  subject: MoneyRaceSubject,
  work: (writer: MoneyWriter, index: number) => Promise<Output>,
): Promise<readonly Output[]> {
  const before = subject.retries?.();
  const outcomes = await Promise.all(
    subject.writers.map(async (writer, index) => work(writer, index)),
  );
  const after = subject.retries?.();
  assert.ok(
    before === undefined || (after ?? 0) > before,
    "The race met no conflict, so it proved nothing of the retries.",
  );
  return outcomes;
}
