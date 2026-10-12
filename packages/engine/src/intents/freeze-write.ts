import { type Id, idSchema, type Result } from "@binference/core";
import { z } from "zod";
import { type AgentRecord, agentRecordSchema } from "../agents/agent-record.js";
import {
  type LedgerDraft,
  ledgerDraftSchema,
  type LedgerEntry,
  ledgerEntrySchema,
} from "../ledger/ledger-entry.js";
import {
  type OrderMove,
  orderMoveSchema,
  type OrderRecord,
  orderRecordSchema,
} from "../orders/order-record.js";
import { epochMsSchema, rowVersionSchema } from "../records/record-fields.js";
import {
  type IntentChange,
  intentChangeSchema,
  type IntentCommit,
  intentCommitSchema,
} from "./intent-change.js";

/** An agent a freeze marks, under the agent row's version the freezer read. */
export interface AgentFreeze {
  readonly agentId: Id<"agt">;
  readonly expectedVersion: number;
}

/** Parses an agent freeze. */
export const agentFreezeSchema: z.ZodType<AgentFreeze> = z.strictObject({
  agentId: idSchema("agt"),
  expectedVersion: rowVersionSchema,
});

/**
 * One freeze or unfreeze, written all or nothing (ARCHITECTURE.md section 11, decisions 0128 and
 * 0189): each agent marked frozen at `atMs`, or unfrozen, the install too when the write covers the
 * whole install, each intent's move with its event, ledger entry and card writes, each auto order's
 * move after the agents are marked, and the write's own ledger entries.
 */
export interface FreezeWrite {
  readonly atMs: number;
  /** Whether the write freezes, or with `false` lifts a freeze: an unfreeze. */
  readonly isFrozen: boolean;
  /** The agents the write marks; one frozen before a freeze keeps the time it was frozen first. */
  readonly agents: readonly AgentFreeze[];
  /**
   * Whether the write covers the whole install: a freeze also marks the install frozen, keeping
   * the time of an earlier freeze, so every agent created later starts frozen; an unfreeze clears
   * the install's freeze.
   */
  readonly isWholeInstall: boolean;
  /**
   * A freeze's moves of the agents' unsigned intents to `cancelled`, or an unfreeze's move of its
   * own intent to `reconciled`.
   */
  readonly moves: readonly IntentChange[];
  /**
   * A freeze's moves of the agents' active orders to `paused` and of those awaiting their card to
   * `cancelled`, or an unfreeze's moves of its agents' paused orders back to `active`, or to
   * `expired` once past their expiry.
   */
  readonly orders: readonly OrderMove[];
  /** One `freeze` or `unfreeze` entry for each agent it marks, and one for the install. */
  readonly ledger: readonly LedgerDraft[];
}

/** Parses a freeze write. */
export const freezeWriteSchema: z.ZodType<FreezeWrite> = z.strictObject({
  atMs: epochMsSchema,
  isFrozen: z.boolean(),
  agents: z.array(agentFreezeSchema),
  isWholeInstall: z.boolean(),
  moves: z.array(intentChangeSchema),
  orders: z.array(orderMoveSchema),
  ledger: z.array(ledgerDraftSchema),
});

/**
 * What a freeze wrote: each agent as it is now, each intent move, each order after its move, and
 * the freeze's entries.
 */
export interface FreezeCommit {
  readonly agents: readonly AgentRecord[];
  readonly moves: readonly IntentCommit[];
  readonly orders: readonly OrderRecord[];
  readonly ledgerEntries: readonly LedgerEntry[];
}

/** Parses what a freeze wrote. */
export const freezeCommitSchema: z.ZodType<FreezeCommit> = z.strictObject({
  agents: z.array(agentRecordSchema),
  moves: z.array(intentCommitSchema),
  orders: z.array(orderRecordSchema),
  ledgerEntries: z.array(ledgerEntrySchema),
});

/** What the intent store answers a freeze: what it wrote, or why it wrote nothing. */
export type FreezeOutcome = Result<FreezeCommit, "not_found" | "stale">;
