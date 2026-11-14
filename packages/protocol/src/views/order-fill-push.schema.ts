import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type OrderFillView, orderFillViewSchema } from "./order-view.schema.js";

/**
 * The data of an `order/filled` or `order/skipped` push on the `order` topic (protocol spec,
 * section 6): one fill or skip row of an auto order, sent once as it is stored, whether or not the
 * owner is told of it.
 */
export interface OrderFillPush {
  readonly order: ProtocolId<"autoOrder">;
  readonly agent: ProtocolId<"agent">;
  readonly fill: OrderFillView;
}

/** Parses the data of an `order/filled` or `order/skipped` push. */
export const orderFillPushSchema: z.ZodType<OrderFillPush> = z.object({
  order: protocolIdSchema("autoOrder"),
  agent: protocolIdSchema("agent"),
  fill: orderFillViewSchema,
});
