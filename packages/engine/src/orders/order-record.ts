import type { AssetRef } from "@binference/chain";
import { type Id, idSchema, type JsonValue, jsonValueSchema } from "@binference/core";
import {
  type OrderEndReason,
  type OrderRequest,
  orderRequestSchema,
  type OrderState,
  orderStateSchema,
} from "@binference/protocol";
import { z } from "zod";
import { type DocumentCodec, documentCodec } from "../intents/intent-documents.schema.js";
import { epochMsSchema, pageLimitSchema, rowVersionSchema } from "../records/record-fields.js";

/** The kind of an auto order (spec 1, section 8.2). */
export type OrderKind = OrderRequest["kind"];

/**
 * A new auto order to store, awaiting its card (database spec, section 2.4; decision 0189): its
 * request with every default filled, the `autoOrder` intent that carries its card, its mode and the
 * proposing turn's mark.
 */
export interface OrderDraft {
  readonly id: Id<"ord">;
  readonly agentId: Id<"agt">;
  readonly walletId: Id<"wal">;
  readonly request: OrderRequest;
  /** Absent: no limit on its fills, until it expires or ends. */
  readonly maxFills?: number;
  readonly expiresAtMs: number;
  readonly intentId: Id<"int">;
  /** The agent's mode when the order was made: the mode every fill runs in. */
  readonly isPaper: boolean;
  readonly hasOutsideContent: boolean;
  readonly atMs: number;
}

/** A stored auto order: its draft, where it stands, its fills and its row version. */
export interface OrderRecord extends Omit<OrderDraft, "atMs"> {
  readonly kind: OrderKind;
  readonly state: OrderState;
  /** What a trigger keeps between prices, such as a trailing stop's highest price. */
  readonly triggerState?: JsonValue;
  readonly fills: number;
  /** The card version that confirmed the order, once it did. */
  readonly cardId?: Id<"crd">;
  readonly endReason?: OrderEndReason;
  /** When `notice.orderExpiring` went for the order. */
  readonly expiryNoticedAtMs?: number;
  readonly createdAtMs: number;
  readonly changedAtMs: number;
  readonly version: number;
}

const orderKindSchema: z.ZodType<OrderKind, string> = z.enum([
  "limit",
  "takeProfit",
  "stopLoss",
  "trailing",
  "dca",
  "copy",
]);
const endReasonSchema: z.ZodType<OrderEndReason, string> = z.enum(["position_closed"]);
const maxFillsSchema = z.int().min(1);

const draftShape = {
  id: idSchema("ord"),
  agentId: idSchema("agt"),
  walletId: idSchema("wal"),
  request: orderRequestSchema,
  maxFills: maxFillsSchema.exactOptional(),
  expiresAtMs: epochMsSchema,
  intentId: idSchema("int"),
  isPaper: z.boolean(),
  hasOutsideContent: z.boolean(),
};

/** An order's request as JSON keeps it: amounts and prices as decimal strings. */
export const orderRequestDocument: DocumentCodec<OrderRequest> = documentCodec(
  "order request",
  orderRequestSchema,
);

/** Parses an order draft. */
export const orderDraftSchema: z.ZodType<OrderDraft> = z.strictObject({
  ...draftShape,
  atMs: epochMsSchema,
});

/** Parses a stored order. */
export const orderRecordSchema: z.ZodType<OrderRecord> = z.strictObject({
  ...draftShape,
  kind: orderKindSchema,
  state: orderStateSchema,
  triggerState: jsonValueSchema.exactOptional(),
  fills: z.int().nonnegative(),
  cardId: idSchema("crd").exactOptional(),
  endReason: endReasonSchema.exactOptional(),
  expiryNoticedAtMs: epochMsSchema.exactOptional(),
  createdAtMs: epochMsSchema,
  changedAtMs: epochMsSchema,
  version: rowVersionSchema,
});

/**
 * One move of an order, written under the version the mover read, the version then rising by one.
 * Only the fields it names change besides its state and time.
 */
export interface OrderMove {
  readonly id: Id<"ord">;
  readonly expectedVersion: number;
  readonly state: OrderState;
  readonly atMs: number;
  /** The card version that confirmed the order, kept as it moves to `active` for the first time. */
  readonly cardId?: Id<"crd">;
  readonly endReason?: OrderEndReason;
  readonly fills?: number;
  readonly triggerState?: JsonValue;
  readonly expiryNoticedAtMs?: number;
}

/** Parses an order move. */
export const orderMoveSchema: z.ZodType<OrderMove> = z.strictObject({
  id: idSchema("ord"),
  expectedVersion: rowVersionSchema,
  state: orderStateSchema,
  atMs: epochMsSchema,
  cardId: idSchema("crd").exactOptional(),
  endReason: endReasonSchema.exactOptional(),
  fills: z.int().nonnegative().exactOptional(),
  triggerState: jsonValueSchema.exactOptional(),
  expiryNoticedAtMs: epochMsSchema.exactOptional(),
});

/** Why a set of order moves wrote nothing. */
export type OrderMoveRefusal =
  /** An order it names is not stored. */
  | "not_found"
  /** An order moved past the version its mover read. */
  | "stale"
  /** A move into `active` whose `autoOrder` intent holds no confirmation of the order's card. */
  | "not_confirmed"
  /** A move into `active` of an order whose agent is frozen. */
  | "frozen";

/** A page of the orders in some states, the oldest first, then by id. */
export interface OrderQuery {
  readonly states: readonly OrderState[];
  readonly agentId?: Id<"agt">;
  readonly walletId?: Id<"wal">;
  readonly isPaper?: boolean;
  /** Only orders that expire at or before this time. */
  readonly expiresByMs?: number;
  /** The last order of the page before: the page starts after it. */
  readonly after?: { readonly createdAtMs: number; readonly id: Id<"ord"> };
  readonly limit: number;
}

/** Parses an order query. */
export const orderQuerySchema: z.ZodType<OrderQuery> = z.strictObject({
  states: z.array(orderStateSchema).min(1),
  agentId: idSchema("agt").exactOptional(),
  walletId: idSchema("wal").exactOptional(),
  isPaper: z.boolean().exactOptional(),
  expiresByMs: epochMsSchema.exactOptional(),
  after: z.strictObject({ createdAtMs: epochMsSchema, id: idSchema("ord") }).exactOptional(),
  limit: pageLimitSchema,
});

/**
 * Whether an order is an exit order of its position (spec 1, section 8.2): a take-profit, a
 * stop-loss, a trailing stop, or a limit order that sells.
 */
export function isExitOrder(request: OrderRequest): boolean {
  return request.kind === "limit" ? request.side === "sell" : isAlwaysExit(request.kind);
}

const exitKinds: ReadonlySet<OrderKind> = new Set<OrderKind>([
  "takeProfit",
  "stopLoss",
  "trailing",
]);

function isAlwaysExit(kind: OrderKind): boolean {
  return exitKinds.has(kind);
}

/** The position an exit order belongs to: its wallet, its token and its mode. */
export interface OrderPosition {
  readonly walletId: Id<"wal">;
  readonly token: AssetRef;
  readonly isPaper: boolean;
}

/** The position an order belongs to. */
export function positionOf(
  order: Pick<OrderRecord, "walletId" | "request" | "isPaper">,
): OrderPosition {
  return { walletId: order.walletId, token: order.request.token, isPaper: order.isPaper };
}
