import { type Id, idSchema, type Result } from "@binference/core";
import { z } from "zod";
import { type AgentRecord, agentRecordSchema } from "../agents/agent-record.js";
import {
  type LedgerDraft,
  ledgerDraftSchema,
  type LedgerEntry,
  ledgerEntrySchema,
} from "../ledger/ledger-entry.js";
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
 * One freeze, written all or nothing (ARCHITECTURE.md section 11): each agent marked frozen at
 * `atMs`, the install too for a freeze of the whole install, each intent's move to `cancelled`
 * with its event, ledger entry and card closing, and the freeze's own ledger entries.
 */
export interface FreezeWrite {
  readonly atMs: number;
  /** The agents the freeze marks; one already frozen keeps the time it was frozen first. */
  readonly agents: readonly AgentFreeze[];
  /**
   * Whether the freeze covers the whole install: it also marks the install frozen, keeping the
   * time of an earlier freeze, and every agent created later starts frozen.
   */
  readonly isWholeInstall: boolean;
  /** The moves of the agents' unsigned intents to `cancelled`. */
  readonly moves: readonly IntentChange[];
  /** One `freeze` entry for each agent it marks, and one for the install it marks. */
  readonly ledger: readonly LedgerDraft[];
}

/** Parses a freeze write. */
export const freezeWriteSchema: z.ZodType<FreezeWrite> = z.strictObject({
  atMs: epochMsSchema,
  agents: z.array(agentFreezeSchema),
  isWholeInstall: z.boolean(),
  moves: z.array(intentChangeSchema),
  ledger: z.array(ledgerDraftSchema),
});

/** What a freeze wrote: each agent as it is now, each intent move, and the freeze's entries. */
export interface FreezeCommit {
  readonly agents: readonly AgentRecord[];
  readonly moves: readonly IntentCommit[];
  readonly ledgerEntries: readonly LedgerEntry[];
}

/** Parses what a freeze wrote. */
export const freezeCommitSchema: z.ZodType<FreezeCommit> = z.strictObject({
  agents: z.array(agentRecordSchema),
  moves: z.array(intentCommitSchema),
  ledgerEntries: z.array(ledgerEntrySchema),
});

/** What the intent store answers a freeze: what it wrote, or why it wrote nothing. */
export type FreezeOutcome = Result<FreezeCommit, "not_found" | "stale">;
