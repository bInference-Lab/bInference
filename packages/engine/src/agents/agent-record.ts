import { type Id, idSchema, type JsonValue, jsonValueSchema } from "@binference/core";
import { type Locale, localeSchema } from "@binference/protocol";
import { z } from "zod";
import type { ApprovalMode } from "../intents/auto-mode.js";
import type { SendLevel } from "../policy/policy-rules.js";
import { epochMsSchema, rowVersionSchema, shortTextSchema } from "../records/record-fields.js";
import { type AddressEntryRecord, addressEntryRecordSchema } from "./address-entry-record.js";
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
import {
  type SendLevelRecord,
  sendLevelRecordSchema,
  sendLevelSchema,
} from "./send-level-record.js";

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

/**
 * A new agent with its first limits, approval mode and send level, written in one transaction at
 * `atMs`.
 */
export interface AgentDraft extends Pick<
  AgentRecord,
  "id" | "name" | "mode" | "locale" | "models" | "notifications"
> {
  readonly atMs: number;
  readonly limits: LimitsValues;
  readonly approvalMode: ApprovalMode;
  readonly sendLevel: SendLevel;
  /** The surface the agent was made on. */
  readonly bySurface: string;
}

/** Parses an agent draft. */
export const agentDraftSchema: z.ZodType<AgentDraft> = z.strictObject({
  ...agentShape,
  atMs: epochMsSchema,
  limits: limitsValuesSchema,
  approvalMode: approvalModeSchema,
  sendLevel: sendLevelSchema,
  bySurface: shortTextSchema,
});

/**
 * An agent with the settings the money path reads: its limits, approval mode, send level and
 * address book.
 */
export interface AgentSettings {
  readonly agent: AgentRecord;
  readonly limits: LimitsRecord;
  readonly approvalMode: ApprovalModeRecord;
  readonly sendLevel: SendLevelRecord;
  /** The live entries of the agent's address book, oldest first. */
  readonly addressBook: readonly AddressEntryRecord[];
}

/** Parses an agent's settings. */
export const agentSettingsSchema: z.ZodType<AgentSettings> = z.strictObject({
  agent: agentRecordSchema,
  limits: limitsRecordSchema,
  approvalMode: approvalModeRecordSchema,
  sendLevel: sendLevelRecordSchema,
  addressBook: z.array(addressEntryRecordSchema),
});

/**
 * A new mode for an agent, under the agent row's version the changer read. Going live is a
 * loosening only `agent/goLive` makes; going back to paper is a braking.
 */
export interface AgentModeChange {
  readonly agentId: Id<"agt">;
  readonly mode: AgentMode;
  readonly atMs: number;
  readonly expectedVersion: number;
}

/** Parses an agent mode change. */
export const agentModeChangeSchema: z.ZodType<AgentModeChange> = z.strictObject({
  agentId: idSchema("agt"),
  mode: agentShape.mode,
  atMs: epochMsSchema,
  expectedVersion: rowVersionSchema,
});

/**
 * New notice settings for an agent (decision 0185), under the agent row's version the changer
 * read. The store keeps them as the document it is given.
 */
export interface AgentNotificationsChange {
  readonly agentId: Id<"agt">;
  readonly notifications: JsonValue;
  readonly atMs: number;
  readonly expectedVersion: number;
}

/** Parses an agent notifications change. */
export const agentNotificationsChangeSchema: z.ZodType<AgentNotificationsChange> = z.strictObject({
  agentId: idSchema("agt"),
  notifications: jsonValueSchema,
  atMs: epochMsSchema,
  expectedVersion: rowVersionSchema,
});

/**
 * The models the owner picked for an agent, by role (decision 0204), under the agent row's version
 * the changer read. The store keeps them as the document it is given.
 */
export interface AgentModelsChange {
  readonly agentId: Id<"agt">;
  readonly models: JsonValue;
  readonly atMs: number;
  readonly expectedVersion: number;
}

/** Parses an agent models change. */
export const agentModelsChangeSchema: z.ZodType<AgentModelsChange> = z.strictObject({
  agentId: idSchema("agt"),
  models: jsonValueSchema,
  atMs: epochMsSchema,
  expectedVersion: rowVersionSchema,
});

/** The settings a new agent starts with: its draft's values, all at version 0, and no addresses. */
export function agentSettingsOf(draft: AgentDraft): AgentSettings {
  const { atMs, limits, approvalMode, sendLevel, bySurface, ...agent } = draft;
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
    sendLevel: { agentId: draft.id, level: sendLevel, changedAtMs: atMs, version: 0 },
    addressBook: [],
  };
}
