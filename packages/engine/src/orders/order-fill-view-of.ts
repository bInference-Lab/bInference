import type { Id } from "@binference/core";
import type { OrderFillView } from "@binference/protocol";
import { z } from "zod";
import type { EnginePush } from "../pushes/engine-push.js";
import type { OrderFillRecord } from "./order-fill.js";

/** The reason part of the `notice.skipped` notice a told skip keeps on its row (decision 0197). */
interface ToldReason {
  readonly key: string;
  readonly values: Readonly<Record<string, string>>;
}

const toldReasonSchema: z.ZodType<{ readonly parts: { readonly reason: ToldReason } }> =
  z.looseObject({
    parts: z.looseObject({
      reason: z.looseObject({ key: z.string(), values: z.record(z.string(), z.string()) }),
    }),
  });

// The values a skip's reason words take, from the notice the owner was told of it; none for a
// row that kept no notice, or whose reason takes none.
function reasonValuesOf(row: OrderFillRecord): Readonly<Record<string, string>> | undefined {
  const key = `reason.${String(row.reason)}`;
  const values = (row.notices ?? [])
    .map((notice) => toldReasonSchema.safeParse(notice).data?.parts.reason)
    .find((reason) => reason?.key === key)?.values;
  return values === undefined || Object.keys(values).length === 0 ? undefined : values;
}

/**
 * One fill row as every surface draws it (protocol spec, section 8.3): a fill, or a skip with its
 * reason and the values its words take when the owner was told of it.
 */
export function orderFillViewOf(row: OrderFillRecord): OrderFillView {
  const reasonValues = row.outcome === "skipped" ? reasonValuesOf(row) : undefined;
  return {
    fill: row.id,
    ...(row.intentId === undefined ? {} : { intent: row.intentId }),
    outcome: row.outcome,
    ...(row.reason === undefined ? {} : { reason: row.reason }),
    ...(reasonValues === undefined ? {} : { reasonValues }),
    at: row.atMs,
  };
}

/**
 * The `order/filled` or `order/skipped` push of one fill row as it was stored (protocol spec,
 * section 6): each writer of a row sends it once, after its write lands, whether or not the owner
 * is told of the row.
 */
export function orderFillPush(row: OrderFillRecord, agent: Id<"agt">): EnginePush {
  // The view as JSON: its fields copied into plain objects.
  const { reasonValues, ...view } = orderFillViewOf(row);
  const fill =
    reasonValues === undefined ? { ...view } : { ...view, reasonValues: { ...reasonValues } };
  const kind = row.outcome === "filled" ? "order/filled" : "order/skipped";
  return { topic: "order", kind, data: { order: row.orderId, agent, fill } };
}
