import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import type { ApprovalMode } from "../intents/auto-mode.js";
import { epochMsSchema, rowVersionSchema, shortTextSchema } from "../records/record-fields.js";

/** Parses an approval mode, `manual` or `auto`. */
export const approvalModeSchema: z.ZodType<ApprovalMode, string> = z.enum(["manual", "auto"]);

/**
 * An agent's approval mode as the store keeps it (decision 0088). The auto mode authorizes an
 * intent under one version of this row; a change ends that authorization.
 */
export interface ApprovalModeRecord {
  readonly agentId: Id<"agt">;
  readonly mode: ApprovalMode;
  /** The surface the owner changed it on, such as `console` or `cli`. */
  readonly changedBySurface: string;
  readonly changedAtMs: number;
  readonly version: number;
}

/** Parses an approval mode record. */
export const approvalModeRecordSchema: z.ZodType<ApprovalModeRecord> = z.strictObject({
  agentId: idSchema("agt"),
  mode: approvalModeSchema,
  changedBySurface: shortTextSchema,
  changedAtMs: epochMsSchema,
  version: rowVersionSchema,
});

/** A new approval mode for an agent, under the version the changer read. */
export interface ApprovalModeChange {
  readonly agentId: Id<"agt">;
  readonly mode: ApprovalMode;
  readonly bySurface: string;
  readonly atMs: number;
  readonly expectedVersion: number;
}

/** Parses an approval mode change. */
export const approvalModeChangeSchema: z.ZodType<ApprovalModeChange> = z.strictObject({
  agentId: idSchema("agt"),
  mode: approvalModeSchema,
  bySurface: shortTextSchema,
  atMs: epochMsSchema,
  expectedVersion: rowVersionSchema,
});
