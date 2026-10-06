import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type OrderRequest, readOrderRequestSchema } from "../requests/fill-rule-request.schema.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";

const orderStates = [
  "awaiting_confirmation",
  "active",
  "filled",
  "cancelled",
  "expired",
  "ended",
] as const;

/** Where an auto order stands; it is `active` once its one card is confirmed. */
export type OrderState = (typeof orderStates)[number];

/** One fill of an auto order, or a fill it skipped and why. */
export interface OrderFillView {
  readonly fill: ProtocolId<"orderFill">;
  readonly intent?: ProtocolId<"intent">;
  readonly outcome: "filled" | "skipped";
  readonly reason?: string;
  readonly at: number;
}

/** An auto order: its request, its state and how many times it filled. */
export interface OrderView {
  readonly order: ProtocolId<"autoOrder">;
  readonly agent: ProtocolId<"agent">;
  readonly wallet: ProtocolId<"wallet">;
  readonly kind: OrderRequest["kind"];
  readonly state: OrderState;
  readonly request: OrderRequest;
  readonly fills: number;
  readonly maxFills?: number;
  readonly expiresAt: number;
  /** The card that confirms the order, until it is answered. */
  readonly card?: ProtocolId<"card">;
  readonly createdAt: number;
  readonly changedAt: number;
  /** Each fill and skipped fill, newest first; `order/get` carries it, lists leave it out. */
  readonly fillHistory?: readonly OrderFillView[];
}

/** Parses an order state, the `order/list` filter. */
export const orderStateSchema: z.ZodType<OrderState, string> = z.enum(orderStates);

/** Parses an order view. */
export const orderViewSchema: z.ZodType<OrderView> = z.object({
  order: protocolIdSchema("autoOrder"),
  agent: protocolIdSchema("agent"),
  wallet: protocolIdSchema("wallet"),
  kind: z.enum(["limit", "takeProfit", "stopLoss", "trailing", "dca", "copy"]),
  state: orderStateSchema,
  request: readOrderRequestSchema,
  fills: z.int().nonnegative(),
  maxFills: z.int().min(1).exactOptional(),
  expiresAt: epochMsSchema,
  card: protocolIdSchema("card").exactOptional(),
  createdAt: epochMsSchema,
  changedAt: epochMsSchema,
  fillHistory: z
    .array(
      z.object({
        fill: protocolIdSchema("orderFill"),
        intent: protocolIdSchema("intent").exactOptional(),
        outcome: z.enum(["filled", "skipped"]),
        reason: z
          .string()
          .regex(/^[a-z][a-z_]*$/)
          .exactOptional(),
        at: epochMsSchema,
      }),
    )
    .exactOptional(),
});
