import { type AccountRef, accountRefSchema } from "@binference/chain";
import {
  decimalStringSchema,
  type Id,
  idSchema,
  type JsonValue,
  jsonValueSchema,
} from "@binference/core";
import { z } from "zod";
import {
  type IntentReason,
  intentReasons,
  type OrderSkipReason,
  orderSkipReasons,
} from "../intents/intent-reason.js";
import { epochMsSchema, pageLimitSchema } from "../records/record-fields.js";
import { type OrderMove, orderMoveSchema } from "./order-record.js";

/** Why a fill was skipped: the reason its intent ended with, or the order's own before any. */
export type OrderFillReason = IntentReason | OrderSkipReason;

/**
 * One fill of an auto order as `order_fills` keeps it (database spec, section 2.4): `filled` with
 * the intent that filled, or `skipped` with its reason and the intent that ended, if one was
 * stored.
 */
export interface OrderFillRecord {
  readonly id: Id<"fil">;
  readonly orderId: Id<"ord">;
  readonly intentId?: Id<"int">;
  readonly outcome: "filled" | "skipped";
  /** Absent for a fill. */
  readonly reason?: OrderFillReason;
  readonly atMs: number;
  /**
   * What the owner hears of this fill or skip, each notice as its push carries it, written with
   * the row (decision 0197); absent when the owner hears nothing of it.
   */
  readonly notices?: readonly JsonValue[];
  /** When the notices were announced; absent until they are, and for a row without notices. */
  readonly announcedAtMs?: number;
  /**
   * A copy order's row: the stored number of the leader trade it copied, and the take of the order
   * it ran under (decision 0260).
   */
  readonly copy?: { readonly trade: number; readonly take: number };
}

// A skip carries its reason and a fill none; only a row with notices is announced.
function isWellFormed(row: {
  readonly outcome: string;
  readonly reason?: string | undefined;
  readonly notices?: readonly JsonValue[] | undefined;
  readonly announcedAtMs?: number | undefined;
}): boolean {
  const isReasoned = (row.outcome === "skipped") === (row.reason !== undefined);
  return isReasoned && (row.announcedAtMs === undefined || row.notices !== undefined);
}

const fillReasonCodes: ReadonlySet<string> = new Set<string>([
  ...intentReasons,
  ...orderSkipReasons,
]);

/** Parses one fill row. A skip carries a reason and a fill none. */
export const orderFillRecordSchema: z.ZodType<OrderFillRecord> = z
  .strictObject({
    id: idSchema("fil"),
    orderId: idSchema("ord"),
    intentId: idSchema("int").exactOptional(),
    outcome: z.enum(["filled", "skipped"]),
    reason: z
      .string()
      .refine((code): code is OrderFillReason => fillReasonCodes.has(code))
      .exactOptional(),
    atMs: epochMsSchema,
    notices: z.array(jsonValueSchema).min(1).exactOptional(),
    announcedAtMs: epochMsSchema.exactOptional(),
    copy: z.strictObject({ trade: z.int().positive(), take: z.int().positive() }).exactOptional(),
  })
  .refine(isWellFormed, {
    message: "A skip carries its reason and a fill none, and only a row with notices is announced.",
  });

/**
 * What a paper fill writes on its order in the fill's own transaction (spec 6, section 5): the
 * order's move, the moves that end the other exit orders of a position it emptied, and the fill's
 * row.
 */
export interface OrderFillWrite {
  readonly moves: readonly OrderMove[];
  readonly fill: OrderFillRecord;
}

/**
 * Whether a fill write records its fill on its own order (decision 0197): a `filled` row lands
 * only with its order's move to one fill more than the `fillsBefore` it had; a skip needs none.
 */
export function recordsOwnFill(write: OrderFillWrite, fillsBefore: number): boolean {
  const { fill, moves } = write;
  return (
    fill.outcome !== "filled" ||
    moves.some(({ id, fills }) => id === fill.orderId && fills === fillsBefore + 1)
  );
}

/** Parses an order fill write. */
export const orderFillWriteSchema: z.ZodType<OrderFillWrite> = z.strictObject({
  moves: z.array(orderMoveSchema),
  fill: orderFillRecordSchema,
});

/** A page of one order's fill rows, the newest first. */
export interface OrderFillQuery {
  readonly orderId: Id<"ord">;
  readonly limit: number;
}

/** A page of the fill rows whose notices were never announced, the oldest first. */
export interface UnannouncedFillQuery {
  readonly limit: number;
}

/** Parses an unannounced fill query. */
export const unannouncedFillQuerySchema: z.ZodType<UnannouncedFillQuery> = z.strictObject({
  limit: pageLimitSchema,
});

/** The rows whose notices are announced, and when. */
export interface FillAnnouncement {
  readonly ids: readonly Id<"fil">[];
  readonly atMs: number;
}

/** Parses a fill announcement. */
export const fillAnnouncementSchema: z.ZodType<FillAnnouncement> = z.strictObject({
  ids: z.array(idSchema("fil")).min(1).max(500),
  atMs: epochMsSchema,
});

/** Parses an order fill query. */
export const orderFillQuerySchema: z.ZodType<OrderFillQuery> = z.strictObject({
  orderId: idSchema("ord"),
  limit: pageLimitSchema,
});

/**
 * Which copy buys of an agent to list (decision 0260): the `filled` rows of its copy orders of one
 * leader whose intents bought, in any order state, from `fromMs` on, oldest first, then by id.
 */
export interface CopyBuyQuery {
  readonly agentId: Id<"agt">;
  readonly leader: AccountRef;
  readonly fromMs: number;
  /** The last row of the page before: the page starts after it. */
  readonly after?: { readonly atMs: number; readonly id: Id<"fil"> };
  readonly limit: number;
}

/** Parses a copy buy query. */
export const copyBuyQuerySchema: z.ZodType<CopyBuyQuery> = z.strictObject({
  agentId: idSchema("agt"),
  leader: accountRefSchema,
  fromMs: epochMsSchema,
  after: z.strictObject({ atMs: epochMsSchema, id: idSchema("fil") }).exactOptional(),
  limit: pageLimitSchema,
});

/**
 * One copy buy as the daily cap counts it: its row, when it filled, and the value the policy judged
 * its intent at, else the dollars per buy of its order.
 */
export interface CopyBuyRecord {
  readonly id: Id<"fil">;
  readonly atMs: number;
  readonly usdMicros: bigint;
}

/** Parses a copy buy. */
export const copyBuyRecordSchema: z.ZodType<CopyBuyRecord> = z.strictObject({
  id: idSchema("fil"),
  atMs: epochMsSchema,
  usdMicros: decimalStringSchema,
});
