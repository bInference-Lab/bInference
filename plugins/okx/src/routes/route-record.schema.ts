import { BinferenceError } from "@binference/plugin-sdk";
import { z } from "zod";

/** What the venue keeps of a quoted route for its build: the DEX ids it excluded, and its protocols. */
export interface RouteRecord {
  readonly excludedDexIds: readonly string[];
  readonly sources: readonly string[];
}

const routeRecordSchema: z.ZodType<RouteRecord> = z.strictObject({
  excludedDexIds: z.array(z.string().regex(/^\d{1,9}$/)),
  sources: z.array(z.string()),
});

/** Writes a route record as the quote's `route` text. */
export function routeRecordOf(record: RouteRecord): string {
  return JSON.stringify(record);
}

/** Reads the route record a quote of this venue carries; any other text throws `okx.no_route`. */
export function readRouteRecord(text: string | undefined): RouteRecord {
  let parsed: unknown;
  try {
    parsed = text === undefined ? undefined : JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const record = routeRecordSchema.safeParse(parsed);
  if (record.success) {
    return record.data;
  }
  throw new BinferenceError({
    code: "okx.no_route",
    message: "The quote carries no OKX route to build.",
  });
}
