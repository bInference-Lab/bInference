import { type AssetRef, assetRefSchema } from "@binference/chain";
import { decimalStringSchema } from "@binference/core";
import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";

/** Fires when an asset's price crosses `price`, in micro-dollars, in `direction`. */
export interface PriceCondition {
  readonly kind: "price";
  readonly asset: AssetRef;
  readonly direction: "above" | "below";
  readonly price: bigint;
}

/** What an alert watches. It notifies and sends no transaction. */
export type AlertCondition = PriceCondition;

/** An alert and whether it fired. */
export interface AlertView {
  readonly alert: ProtocolId<"alert">;
  readonly agent: ProtocolId<"agent">;
  readonly condition: AlertCondition;
  readonly state: "active" | "fired" | "deleted";
  readonly createdAt: number;
  readonly firedAt?: number;
}

const priceShape = {
  kind: z.literal("price"),
  asset: assetRefSchema,
  direction: z.enum(["above", "below"]),
  price: decimalStringSchema,
};

/** Parses the condition of `alert/create`. Unknown fields are refused. */
export const alertConditionSchema: z.ZodType<AlertCondition> = z.discriminatedUnion("kind", [
  z.strictObject(priceShape),
]);

/** Parses an alert view. */
export const alertViewSchema: z.ZodType<AlertView> = z.object({
  alert: protocolIdSchema("alert"),
  agent: protocolIdSchema("agent"),
  condition: z.discriminatedUnion("kind", [z.object(priceShape)]),
  state: z.enum(["active", "fired", "deleted"]),
  createdAt: epochMsSchema,
  firedAt: epochMsSchema.exactOptional(),
});
