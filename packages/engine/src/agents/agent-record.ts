import { type Id, idSchema, type JsonValue, jsonValueSchema } from "@binference/core";
import { type Locale, localeSchema } from "@binference/protocol";
import { z } from "zod";
import type { ApprovalMode } from "../intents/auto-mode.js";
import { epochMsSchema, rowVersionSchema, shortTextSchema } from "../records/record-fields.js";
import {
  type ApprovalModeRecord,
  approvalModeRecordSchema,
  approvalModeSchema,
} from "./approval-mode-record.js";
import {
  type LimitsRecord,
  limitsRecordSchema,
  type LimitsValues,
  limitsValuesSchema,
} from "./limits-record.js";

/** Whether an agent trades on paper or for real. */
export type AgentMode = "paper" | "live";

/** One agent as the store keeps it. Its models and notifications are config documents. */
export interface AgentRecord {
  readonly id: Id<"agt">;
  /** Unique among the install's agents. */
  readonly name: string;
  readonly mode: AgentMode;
  readonly locale: Locale;
  readonly models: JsonValue;
  readonly notifications: JsonValue;
  readonly frozenAtMs?: number;
  readonly archivedAtMs?: number;
  readonly createdAtMs: number;
  readonly changedAtMs: number;
  readonly version: number;
}

const agentShape = {
  id: idSchema("agt"),
  name: z.string().min(1).max(64),
  mode: z.enum(["paper", "live"]),
  locale: localeSchema,
  models: jsonValueSchema,
  notifications: jsonValueSchema,
};

/** Parses an agent record. */
export const agentRecordSchema: z.ZodType<AgentRecord> = z.strictObject({
  ...agentShape,
  frozenAtMs: epochMsSchema.exactOptional(),
  archivedAtMs: epochMsSchema.exactOptional(),
  createdAtMs: epochMsSchema,
  changedAtMs: epochMsSchema,
  version: rowVersionSchema,
});

/** A new agent with its first limits and approval mode, written in one transaction at `atMs`. */
export interface AgentDraft extends Pick<
  AgentRecord,
  "id" | "name" | "mode" | "locale" | "models" | "notifications"
> {
  readonly atMs: number;
  readonly limits: LimitsValues;
  readonly approvalMode: ApprovalMode;
  /** The surface the agent was made on. */
  readonly bySurface: string;
}

/** Parses an agent draft. */
export const agentDraftSchema: z.ZodType<AgentDraft> = z.strictObject({
  ...agentShape,
  atMs: epochMsSchema,
  limits: limitsValuesSchema,
  approvalMode: approvalModeSchema,
  bySurface: shortTextSchema,
});

/** An agent with the settings the money path reads: its limits and its approval mode. */
export interface AgentSettings {
  readonly agent: AgentRecord;
  readonly limits: LimitsRecord;
  readonly approvalMode: ApprovalModeRecord;
}

/** Parses an agent's settings. */
export const agentSettingsSchema: z.ZodType<AgentSettings> = z.strictObject({
  agent: agentRecordSchema,
  limits: limitsRecordSchema,
  approvalMode: approvalModeRecordSchema,
});

/** The settings a new agent starts with: its draft's values, all at version 0. */
export function agentSettingsOf(draft: AgentDraft): AgentSettings {
  const { atMs, limits, approvalMode, bySurface, ...agent } = draft;
  return {
    agent: { ...agent, createdAtMs: atMs, changedAtMs: atMs, version: 0 },
    limits: { ...limits, agentId: draft.id, changedAtMs: atMs, version: 0 },
    approvalMode: {
      agentId: draft.id,
      mode: approvalMode,
      changedBySurface: bySurface,
      changedAtMs: atMs,
      version: 0,
    },
  };
}
